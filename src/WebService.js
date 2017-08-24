var express = require("express");
var bodyParser = require('body-parser');
var TwilioReceiver = require("./twilio/TwilioReceiver");
var LogService = require("./LogService");

/**
 * Primary web handler for the bridge. Serves the front end and exposes a way for other services
 * to provide endpoints.
 */
class WebService {

    /**
     * Creates a new web service. Call `bind` before use.
     */
    constructor() {
        this._app = express();

        this._app.use(bodyParser.json());
        this._app.use(bodyParser.urlencoded({extended: true}));
    }

    /**
     * Binds the web service to a hostname and port
     * @param {string} hostname the hostname to bind to
     * @param {number} port the port to bind on
     * @param {string} secret the known secret
     */
    bind(hostname, port, secret) {
        this._app.listen(port, hostname);

        LogService.verbose("WebService", "Bootstrapping components");
        TwilioReceiver.bootstrap(this._app, secret);
    }
}

module.exports = new WebService();