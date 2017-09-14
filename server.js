const express = require('express');
const bodyParser = require('body-parser');
const pluralize = require('pluralize');

const mongoClient = require('mongodb').MongoClient;
const webClient = require('@slack/client').WebClient;

const app = express();

const port = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').load();
}

var db;

let mongoDbUri = process.env.MONGODB_URI;

mongoClient.connect(mongoDbUri, (err, database) => {
    if (err) return console.log(err);
    db = database;
    app.listen(port, () => {
        console.log('listening on port: ' + port)
    })
});

var token = process.env.SLACK_API_TOKEN || '';

var web = new webClient(token);

// let jsonParser = bodyParser.json();
app.use(bodyParser.json());
// let formParser = bodyParser.urlencoded({extended: true});
app.use(bodyParser.urlencoded({extended: true}));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html')
});

app.post('/puppypaws', (request, response) => {
    let text = request.body.text;
    let mentionedUser = text.match(/<@(.*?)\w+/g);
    if (mentionedUser) {
        let receiverId = mentionedUser[0].substring(2);
        let receiverName = text.match(/\|([a-z])+/g)[0].substring(1);
        console.log('request: ');
        for (var key in request.body) {
            var value = request.body[key];

            console.log(key + '=', value);
        }

        var interactiveMessage = {
            "attachments": [
                {
                    "text": "u mentioned a hooman! wat do u want to do for " + receiverName + "?",
                    "fallback": "oops, norbert is nap now",
                    "callback_id": "send_or_stats",
                    "color": "good",
                    "attachment_type": "primary",
                    "actions": [
                        {
                            "name": "send",
                            "text": "Send them a puppy paw!",
                            "type": "button",
                            "value": receiverId
                        },
                        {
                            "name": "stats",
                            "text": "See their number of puppy paws",
                            "type": "button",
                            "value": "stats"
                        }
                    ]
                }
            ]
        };
        response.json(interactiveMessage);
        // sendPaw(request.body, receiverId);
    } else {
        web.chat.postEphemeral(
            request.body.channel_id,
            'Oops, you must mention someone to send them a puppy paw',
            request.body.user_id,
            function (err, res) {
                if (err) {
                    console.log('Error:', err);
                }
            }
        );
    }
    response.end();
});

app.post('/slack/actions', (request, response) => {
    let payload = JSON.parse(request.body.payload);

    if (payload.actions[0].name === "send") {
        let pawRecipient = payload.actions[0].value;
        let escapedPawRecipient = '<@' + pawRecipient + '>';

        let pawSender = payload.user.id;
        let escapedPawSender = '<@' + pawSender + '>';

        db.collection('paws').findOneAndUpdate(
            {slackUserId: pawRecipient},
            {$inc: {pawsReceived: 1}},
            {upsert: true, returnOriginal: false},
            (receiverError, receiverDoc) => {
                if (receiverError) {
                    response.send("Norbert is sorry, he couldn't send a puppy paw to your friend. Please try again later.");
                } else {
                    let receiverPawsReceivedCount = receiverDoc.value.pawsReceived;
                    let message = 'High-paw, '+ escapedPawRecipient + '! ' + escapedPawSender + ' has sent you a puppy paw! You now have ' +
                        receiverPawsReceivedCount + ' ' + pluralize('paw', receiverPawsReceivedCount) + '!';

                    let highPawMessage = {
                        "response_type": "in_channel",
                        "attachments": [
                            {
                                "fallback": "Norbert says 'High-paw, hooman frend!'",
                                "color": "#36a64f",
                                "pretext": message,
                                "image_url": "https://i.imgur.com/Ii0ALYG.jpg"
                            }
                        ]
                    };

                    db.collection('paws').findOneAndUpdate(
                        {slackUserId: pawSender},
                        {$inc: {pawsSent: 1}},
                        {upsert: true, returnNewDocument: true},
                        (senderError, senderDoc) => {
                            if (senderError) console.log(senderError);
                        }
                    );

                    response.send(highPawMessage);
                }
            }
        );
    }
});

function sendPaw(body, receiverId) {
    let senderId = body.user_id;
    let senderName = body.user_name;
    let escapedSenderId = '<@' + senderId + '>';
    let channelId = body.channel_id;
    let escapedReceiverId = '<@' + receiverId + '>';
    db.collection('paws').findOneAndUpdate(
        {slackUserId: receiverId},
        {$inc: {pawsReceived: 1}},
        {upsert: true, returnOriginal: false},
        (receiverError, receiverDoc) => {
            if (receiverError) {
                web.chat.postEphemeral(
                    channelId,
                    "We're sorry, we couldn't send a puppy paw.  Please try again later",
                    senderId,
                    function (err, res) {
                        if (err) {
                            console.log('Error:', err);
                        }
                    }
                )
            } else {
                let receiverPawsReceivedCount = receiverDoc.value.pawsReceived;
                let message = 'High-paw, '+ escapedReceiverId + '! ' + escapedSenderId + ' has sent you a puppy paw! You now have ' +
                    receiverPawsReceivedCount + ' ' + pluralize('paw', receiverPawsReceivedCount) + '!';
                web.chat.postMessage(channelId,
                    message,
                    senderId,
                    function (err, res) {
                        if (err) console.log('Error:', err);
                    });

                db.collection('paws').findOneAndUpdate(
                    {slackUserId: senderId},
                    {$inc: {pawsSent: 1}},
                    {upsert: true, returnNewDocument: true},
                    (senderError, senderDoc) => {
                        if (senderError) console.log(senderError);
                    }
                );
            }
        }
    );
}