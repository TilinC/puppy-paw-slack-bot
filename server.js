const express = require('express');
const bodyParser = require('body-parser');
const pluralize = require('pluralize');

const mongoClient = require('mongodb').MongoClient;
const webClient = require('@slack/client').WebClient;

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').load();
}

const app = express();
const port = process.env.PORT || 3000;

let db;
let mongoDbUri = process.env.MONGODB_URI;
mongoClient.connect(mongoDbUri, (err, database) => {
    if (err) return console.log(err);
    db = database;
    app.listen(port, () => {
        console.log('listening on port: ' + port)
    })
});

const token = process.env.SLACK_API_TOKEN || '';
const web = new webClient(token);

app.use(express.static('public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true, type: 'application/x-www-form-urlencoded'}));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html')
});

app.post('/puppypaws', (request, response) => {
    let text = request.body.text;
    let mentionedUser = text.match(/<@(.*?)\w+/g);
    if (mentionedUser) {
        let receiverId = mentionedUser[0].substring(2);
        let receiverName = text.match(/\|([a-z])+/g)[0].substring(1);
        var interactiveMessage = {
            "attachments": [
                {
                    "text": "u mentioned a hooman! wat do u want to do for " + receiverName + "?",
                    "fallback": "oops, norbert is nap now",
                    "callback_id": "send_or_stats",
                    "color": "good",
                    "attachment_type": "default",
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
                            "value": receiverId
                        }
                    ]
                }
            ]
        };
        response.json(interactiveMessage);
    } else if (text.includes('leaderboard')) {
        var interactiveMessage = {
            "attachments": [
                {
                    "fallback": "oops, norbert is nap now",
                    "callback_id": "leaderboard",
                    "color": "#3AA3E3",
                    "attachment_type": "default",
                    "actions": [
                        {
                            "name": "top_ten",
                            "text": "Top ten paw collectors",
                            "type": "button",
                            "value": "top_ten"
                        },
                        {
                            "name": "all",
                            "text": "All paw collectors",
                            "type": "button",
                            "value": "all"
                        }
                    ]
                }
            ]
        };
        response.json(interactiveMessage);
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
    switch (payload.actions[0].name) {
        case "send":
            sendPuppyPaw(payload, response);
            break;
        case "stats":
            showPuppyPawStats(payload, response);
            break;
        case "top_ten":
            showTopTen(payload, response);
            break;
        case "all":
            showAll(payload, response);
            break;
        default:
            response.send("Oops, Norbert got confused.  Try again later");
            break;
    }

});

function sendPuppyPaw(payload, response) {
    let pawRecipient = payload.actions[0].value;
    let escapedPawRecipient = '<@' + pawRecipient + '>';

    let pawSender = payload.user.id;
    let pawSenderName = payload.user.name;
    let escapedPawSender = '<@' + pawSender + '>';

    db.collection('paws').findOneAndUpdate(
        {slackUserId: pawRecipient},
        {$inc: {pawsReceived: 1}},
        {upsert: true, returnOriginal: false},
        (receiverError, receiverDoc) => {
            if (receiverError) {
                response.send("Norbert is sorry, he couldn't send a puppy paw to your friend. Please try again later.");
            } else {
                db.collection('paws').findOneAndUpdate(
                    {slackUserId: pawSender},
                    {$inc: {pawsSent: 1}},
                    {upsert: true, returnNewDocument: true},
                    (senderError, senderDoc) => {
                        if (senderError) console.log(senderError);
                    }
                );

                let receiverPawsReceivedCount = receiverDoc.value.pawsReceived;
                let message = "High-paw, " + escapedPawRecipient + "! " + pawSenderName + " has sent you a puppy paw! You now have " +
                    receiverPawsReceivedCount + " " + pluralize("paw", receiverPawsReceivedCount) + "!";
                let options = {
                    "attachments": [
                        {
                            "fallback": "Norbert says 'High-paw, hooman frend!'",
                            "color": "#36a64f",
                            "image_url": "https://puppy-paw-slack-bot.herokuapp.com/images/norbertHighPaw.jpg"
                        }
                    ]
                };

                web.chat.postMessage(payload.channel.id,
                    message,
                    options,
                    function (err, res) {
                        if (err) console.log('Error:', err);
                    });
            }
            response.end();
        }
    );
}

function showPuppyPawStats(payload, response) {
    let pawRecipient = payload.actions[0].value;
    let escapedPawRecipient = '<@' + pawRecipient + '>';
    db.collection('paws').findOne({slackUserId: pawRecipient}, (error, document) => {
            if (error) {
                response.send("Norbert is sorry, he couldn't fetch stats for you. Please try again later.");
            }
            else if (document && document.pawsReceived) {
                response.send(escapedPawRecipient + ' has ' + document.pawsReceived + ' puppy ' + pluralize("paw", document.pawsReceived) + '!');
            } else response.send(escapedPawRecipient + ' has no puppy paws yet.');
        }
    );
}

function showTopTen(payload, response) {
    let query = {pawsReceived: {$exists: true}};
    let projection = {"_id": 1, "slackUserId": 1, "pawsReceived": 1};
    var message = 'Top ten users by number of paws received: ';
    db.collection('paws').find(query, projection).sort({pawsReceived: -1}).limit(10).toArray(function (err, docs) {
        if (err) response.send("Norbert is sorry, he couldn't fetch stats for you. Please try again later.");
        if (docs) {
            docs.forEach(document => {
                message = message + '\n ' + '<@' + document.slackUserId + '>: ' + document.pawsReceived;
            });
            response.send(message);
        }
    });
}

function showAll(payload, response) {
    let query = {slackUserId: {$exists: true}};
    let projection = {"_id": 1, "slackUserId": 1, "pawsReceived": 1, "pawsSent": 1};
    var message = 'All paw collectors: ';
    db.collection('paws').find(query, projection).sort({pawsReceived: -1}).toArray(function (err, docs) {
        if (err) response.send("Norbert is sorry, he couldn't fetch stats for you. Please try again later.");
        if (docs) {
            docs.forEach(document => {
                let pawsReceived = document.pawsReceived || 0;
                let pawsSent = document.pawsSent || 0;
                message = message + '\n ' + '<@' + document.slackUserId + '>: '
                    + pawsReceived + ' ' + pluralize("paw", pawsReceived) + ' received, '
                + pawsSent + ' ' + pluralize("paw", pawsSent) + ' sent';
            });
            response.send(message);
        }
    });
}
