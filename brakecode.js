const debug = require('debug')('brakecode');
const env = require('dotenv').config(),
    querystring = require('querystring'),
    https = require('https');

class Brakecode {
    constructor(api) {
        this.api = api;
        this.transport = new Transport(process.env.BRAKECODE_TRANSPORT || 'brakecode');
    }
    sendReport(options) {
        let nodeReport = process.report !== undefined ?
            { type: 'native', reporter: process.report } :
            { type: 'node-report', reporter: this };
        if (nodeReport.reporter.getReport === undefined) {
            debug(`Node Diagnostic Reports must be enabled.  Use the --experimental-report flag.  See https://nodejs.org/api/report.html.`);
            return 'Aborting.  Node Diagnostic Reports must be enabled.';
        }
        console.log(`BRAKECODE_SOURCE_HOST ${process.env.BRAKECODE_SOURCE_HOST}`);
        let data = JSON.stringify({
            type: nodeReport.type,
            report: nodeReport.reporter.getReport(),
            host: process.env.BRAKECODE_SOURCE_HOST
        });
        console.log(`data ${JSON.parse(data).host}`);
        this.transport.send(data);
    }
}
class Transport {
    constructor(type) {
        this.type = type;
        this.brakecode = {
            send: this.brakecodeSend
        };
        this.pubnub = {
            send: this.pubnubSend
        };
    }
    send(reportData) {
        debugger
        this[`${this.type}`].send(reportData);
    }
    brakecodeSend(data) {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'node-reports.brakecode.com',
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