const debug = require('debug')('brakecode:watcher');

class Watcher {
    constructor(Agent, watched, options) {
        this.Agent = Agent;
        this.watched = watched;
        this.options = {
            interval: 1000,
            ...options
        }
    }
    start() {
        const watcher = this;
        watcher.intervalId = setInterval(() => {
            watcher.watched(watcher.Agent)
        }, watcher.options.interval)
        debug('Started ' + watcher.watched.name);
    }
    stop() {
        clearInterval(this.intervalId);
    }
}

module.exports = Watcher;