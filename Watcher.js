const debug = require('debug')('brakecode:watcher');

class Watcher {
    constructor(Agent, watchee, options) {
        let self = this;
        self.Agent = Agent;
        self.watchee = watchee;
        self.options = {
            interval: 1000
        }
        Object.assign(self.options, options);
    }
    start() {
        let self = this;
        self.intervalId = setInterval(() => { self.watchee(self.Agent) }, self.options.interval);
        debug('Started ' + self.watchee.name);
    }
    stop() {
        clearInterval(this.intervalId);
    }
}

module.exports = Watcher;