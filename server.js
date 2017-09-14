const express = require('express');
const MongoClient = require('mongodb').MongoClient;
const bodyParser= require('body-parser');

const app = express();
const port = process.env.PORT || 3000;

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').load();
}

var db;

let mongoDbUri = process.env.MONGODB_URI;

MongoClient.connect(mongoDbUri, (err, database) => {
    if (err) return console.log(err);
    db = database;
    app.listen(port, () => {
        console.log('listening on ${port}')
    })
});

app.use(bodyParser.urlencoded({extended: true}));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html')
});

app.post('/puppy-paws', (req, res) => {
    db.collection('paws').insertOne(req.body, (err, result) => {
        if (err) return console.log(err);
        console.log('saved to database');
    });

    let sender = req.body.sender;
    let receiver = req.body.receiver;
    res.json(req.body);
});