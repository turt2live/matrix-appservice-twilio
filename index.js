var LogService = require("./src/LogService");
var Cli = require("matrix-appservice-bridge").Cli;
var AppServiceRegistration = require("matrix-appservice-bridge").AppServiceRegistration;
var path = require("path");
var TwilioStore = require("./src/storage/TwilioStore");
var TwilioBridge = require("./src/TwilioBridge");
var WebService = require("./src/WebService");

var cli = new Cli({
    registrationPath: "appservice-registration-twilio.yaml",
    enableRegistration: true,
    enableLocalpart: true,
    bridgeConfig: {
        affectsRegistration: true,
        schema: path.join(__dirname, "config/schema.yml"),
        defaults: {
            homeserver: {
                url: "http://localhost:8008",
                domain: "localhost"
            },
            bot: {
                appearance: {
                    displayName: "Twilio Bridge",
                    avatarUrl: "https://t2bot.io/_matrix/media/v1/download/t2l.io/SOZlqpJCUoecxNFZGGnDEhEy" // sms bridge icon
                }
            },
            twilio: {
                accountSid: "YOUR_SID_HERE",
                authToken: "YOUR_AUTH_TOKEN_HERE"
            },
            bridge: {
                phoneNumber: "+15551234567",
                allowedUsers: ["@me:t2bot.io"]
            },
            advanced: {
                localpartPrefix: "_twilio_",
                localpartBridge: "_twilio",
            },
            web: {
                port: 4501,
                host: '0.0.0.0'
            },
            logging: {
                file: "logs/twilio.log",
                console: true,
                consoleLevel: 'info',
                fileLevel: 'verbose',
                rotate: {
                    size: 52428800,
                    count: 5
                }
            }
        }
    },
    generateRegistration: function (registration, callback) {
        var config = cli.getConfig();

        registration.setId(AppServiceRegistration.generateToken());
        registration.setHomeserverToken(AppServiceRegistration.generateToken());
        registration.setAppServiceToken(AppServiceRegistration.generateToken());
        registration.setRateLimited(false); // disabled because webhooks can get spammy

        if (!registration.getSenderLocalpart()) {
            registration.setSenderLocalpart(config.advanced.localpartBridge);
        }

        registration.addRegexPattern("users", "@" + config.advanced.localpartPrefix + ".*", true);

        callback(registration);
    },
    run: function (port, config, registration) {
        LogService.init(config);
        LogService.info("index", "Preparing database...");
        TwilioStore.prepare().then(() => {
            LogService.info("index", "Preparing bridge...");
            return WebService.bind(config.web.host, config.web.port, config.web.secret);
        }).then(() => {
            var bridge = new TwilioBridge(config, registration);
            return bridge.run(port);
        }).catch(err => {
            LogService.error("Init", "Failed to start the bridge");
            throw err;
        });
    }
});
cli.run();