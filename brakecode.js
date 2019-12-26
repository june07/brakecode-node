require('dotenv').config();
const debug = process.env.DEBUG ? require('debug')('brakecode') : null,
    https = require('https');

class Brakecode {
    constructor(api) {
        if (!process.env.BRAKECODE_API_KEY) {
            if (debug) debug('BRAKECODE_API_KEY not found.');
            console.log('BRAKECODE_API_KEY not found.');
        }
        this.api = api;
        this.transport = new Transport({
            type: process.env.BRAKECODE_TRANSPORT || 'brakecode',
            noredact: process.env.BRAKECODE_NOREDACT || false
        });
    }
    sendReport() {
        let nodeReport = process.report !== undefined ?
            { type: 'native', reporter: process.report } :
            { type: 'node-report', reporter: this };
        if (nodeReport.reporter.getReport === undefined) {
            if (debug) debug(`Node Diagnostic Reports must be enabled.  Use the --experimental-report flag.  See https://nodejs.org/api/report.html.`);
            return 'Node Diagnostic Reports must be enabled.  Use the --experimental-report flag.  See https://nodejs.org/api/report.html.';
        }
        let report = nodeReport.reporter.getReport();
        let data = JSON.stringify({
            type: nodeReport.type,
            report,
            host: process.env.BRAKECODE_SOURCE_HOST
        });
        this.transport.send(data);
        return report;
    }
}
class Transport {
    constructor(options) {
        this.options = options;
        this.server = process.env.BRAKECODE_SERVER || 'brakecode.com';
        this.brakecode = {
            send: this.brakecodeSend.bind(this)
        };
        this.pubnub = {
            send: this.pubnubSend
        };
    }
    send(reportData) {
        this[`${this.options.type}`].send(reportData);
    }
    brakecodeSend(data) {
        let transport = this;

        if (!transport.options.noredact) {
            data = Object.assign({
                rtk: {
                    transform: ['redact', 'json']
                }
            }, JSON.parse(data));
            data = JSON.stringify(data);
        }
        return new Promise((resolve, reject) => {
            const options = {
                hostname: transport.server,
                port: 443,
                path: `/api/v1/report`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': data.length,
                    'X-Api-Key': process.env.BRAKECODE_API_KEY,
                }
            };
            const req = https.request(options, (res) => {
                if (debug) debug('statusCode:', res.statusCode);
                if (debug) debug('headers:', res.headers);

                res.on('data', d => {
                    //process.stdout.write(d);
                });
                res.on('end', () => resolve());
                res.on('aborted', () => reject(new Error('aborted')));
            });
            req.on('error', (e) => {
                if (debug) debug(`Error: ${e}`);
                reject(e);
            });
            req.write(data);
            req.end();
        });
    }
    pubnubSend() {

    }
}

module.exports = (function (api) {
    return new Brakecode(api)
});