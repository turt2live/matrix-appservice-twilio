var express = require('express');
var twilio = require('twilio');
var LogService = require("../LogService");
var PubSub = require("pubsub-js");
var randomString = require("random-string");

/**
 * Exposes a web interface that is used by Twilio
 */
class TwilioReceiver {

    bootstrap(app, secret) {
        this._secret = secret;

        if (this._secret === "SET_A_SECRET") {
            LogService.warn("TwilioReceiver", "Default secret found in configuration. Ignoring configuration value and instead using a random value. Please set the configured secret to something different.");
            this._secret = randomString();
        }

        app.post("/api/v1/twilio/:secret/sms", this._handleSms.bind(this));
    }

    _respondEmpty(response) {
        var twiml = new twilio.twiml.MessagingResponse();
        response.writeHead(200, {'Content-Type': 'text/xml'});
        response.end(twiml.toString());
    }

    _handleSms(request, response) {
        if (request.params.secret !== this._secret) {
            LogService.warn("TwilioReceiver", "Received invalid SMS post: Secret did not match.");
            response.sendStatus(401);
            return;
        }

        LogService.verbose("TwilioReceiver", "Received valid SMS post");
        PubSub.publish("sms_recv", {to: request.body.To, from: request.body.From, body: request.body.Body});
        this._respondEmpty(response);
    }

}

module.exports = new TwilioReceiver();