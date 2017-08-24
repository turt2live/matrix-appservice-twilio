var fs = require("fs");
var config = require("js-yaml").safeLoad(fs.readFileSync("config/config.yaml", "utf8"));

var express = require("express");
var bodyParser = require('body-parser');
var MessagingResponse = require('twilio').twiml.MessagingResponse;

var app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
    extended: true
}));

app.post("/api/v1/twilio/sms", (req, res) => {
    console.log(req.body);

    var twiml = new MessagingResponse();
    twiml.message('Sent from ' + req.body.From + " to " + req.body.To + " with body: " + req.body.Body);
    res.writeHead(200, {'Content-Type': 'text/xml'});
    res.end(twiml.toString());
});

app.listen(config.web.port, config.web.host);
console.log("Listening on " + config.web.host + ":" + config.web.port + "   Press ctrl+c to exit");