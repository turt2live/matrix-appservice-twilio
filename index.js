var LogService = require("./src/LogService");
var Cli = require("matrix-appservice-bridge").Cli;
var AppServiceRegistration = require("matrix-appservice-bridge").AppServiceRegistration;
var path = require("path");
var SmsStore = require("./src/storage/SmsStore");
var SmsBridge = require("./src/SmsBridge");

new Cli({
    registrationPath: "appservice-registration-sms.yaml",
    enableRegistration: true,
    enableLocalpart: true,
    bridgeConfig: {
        affectsRegistration: true,
        schema: path.join(__dirname, "config/schema.yml"),
        defaults: {
            homeserver: {
                url: "http://localhost:8008",
                mediaUrl: "http://localhost:8008",
                domain: "localhost"
            },
            smsBot: {
                appearance: {
                    displayName: "SMS Bridge",
                    avatarUrl: "https://t2bot.io/_matrix/media/v1/download/t2l.io/SOZlqpJCUoecxNFZGGnDEhEy" // sms bridge icon
                }
            },
            twilio: {
                accountSid: "YOUR_SID_HERE",
                accountToken: "YOUR_AUTH_TOKEN_HERE"
            },
            smsBridge: {
                phoneNumber: "+15551234567",
                allowedUsers: ["@me:t2bot.io"]
            },
            logging: {
                file: "logs/sms.log",
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
        registration.setId(AppServiceRegistration.generateToken());
        registration.setHomeserverToken(AppServiceRegistration.generateToken());
        registration.setAppServiceToken(AppServiceRegistration.generateToken());
        registration.setRateLimited(false); // disabled because webhooks can get spammy

        if (!registration.getSenderLocalpart()) {
            registration.setSenderLocalpart("_sms");
        }

        registration.addRegexPattern("users", "@_sms.*", true);

        callback(registration);
    },
    run: function (port, config, registration) {
        LogService.init(config);
        LogService.info("index", "Preparing database...");
        SmsStore.prepare().then(() => {
           LogService.info("index", "Preparing bridge...");
            var bridge = new SmsBridge(config, registration);
            return bridge.run(port);
        }).catch(err => {
            LogService.error("Init", "Failed to start the bridge");
            throw err;
        });
    }
}).run();