const debug = require('debug')('brakecode');
const env = require('dotenv').config(),
    querystring = require('querystring'),
    https = require('https');

class Brakecode {
    constructor(api) {
        if (!process.env.BRAKECODE_API_KEY) {
            debug('BRAKECODE_API_KEY not found.');
            process.exit();
        }
        this.api = api;
        this.transport = new Transport({ type: process.env.BRAKECODE_TRANSPORT || 'brakecode' });
    }
    sendReport(options) {
        let nodeReport = process.report !== undefined ?
            { type: 'native', reporter: process.report } :
            { type: 'node-report', reporter: this };
        if (nodeReport.reporter.getReport === undefined) {
            debug(`Node Diagnostic Reports must be enabled.  Use the --experimental-report flag.  See https://nodejs.org/api/report.html.`);
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
        this.type = options.type;
        this.server = process.env.BRAKECODE_SERVER || 'brakecode.com';
        this.brakecode = {
            send: this.brakecodeSend.bind(this)
        };
        this.pubnub = {
            send: this.pubnubSend
        };
    }
    send(reportData) {
        this[`${this.type}`].send(reportData);
    }
    brakecodeSend(data) {
        let transport = this;
        return new Promise((resolve, reject) => {
            const options = {
                hostname: transport.server,
                port: 443,
                path: `/api/v1/report`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': data.length,
                    'X-Api-Key': process.env.BRAKECODE_API_KEY
                }
            };
            const req = https.request(options, (res) => {
                debug('statusCode:', res.statusCode);
                debug('headers:', res.headers);

                res.on('data', d => {
                    //process.stdout.write(d);
                });
                res.on('end', () => resolve());
                res.on('aborted', () => reject(new Error('aborted')));
            });
            req.on('error', (e) => {
                debug(`Error: ${e}`);
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