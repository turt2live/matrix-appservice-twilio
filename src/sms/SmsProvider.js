var twilio = require("./twilio/TwilioProvider");

// Note: Provider should implement the following methods:
// Promise init(config);
// Promise sendSms(phoneNumber, text);

// TODO: Use interface

module.exports = twilio;