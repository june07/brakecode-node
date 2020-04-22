const debug = process.env.DEBUG ? require('debug')('brakecode') : error => console.log(error),
    //psList = require('@667/ps-list'),
    psList = require('../ps-list'),
    { exec } = require('child_process'),
    { EOL } = require('os'),
    fs = require('fs'),
    path = require('path'),
    os = require('os');

class Agent {
    constructor() {
        let self = this;
        self.processList = {};
        self.stats = {
            startTime: undefined
        };
        self.settings = {
            check_interval: 5000
        };
        self.updating = false;

        if (process.env.BRAKECODE_API_KEY) {
            let brakecodeDir = path.join(os.homedir(), '.brakecode');
            try {
                if (fs.statSync(brakecodeDir).isDirectory()) {
                    fs.writeFileSync(path.join(brakecodeDir, '.env'), 'BRAKECODE_API_KEY=' + process.env.BRAKECODE_API_KEY);
                }
            } catch(error) {
                fs.mkdirSync(brakecodeDir);
                fs.writeFileSync(path.join(brakecodeDir, '.env'), 'BRAKECODE_API_KEY=' + process.env.BRAKECODE_API_KEY);
            }
        }
    }
    getRunningNodeProcesses() {
        return this.processList;
    }
    start() {
        let self = this;
        self.stats.startTime = new Date();
        let check_interval = self.settings.check_interval;

        setInterval(() => {
            Agent.run(self);
        }, check_interval)
    }
    inspectNode(pid) {
        (function stableAgent() {
            if (!Agent.updating) {
                Agent.signalProcess(pid);
            } else {
                setTimeout(stableAgent, 500);
            }
        })();
    }
    static signalProcess(pid) {
        exec('/bin/kill -s SIGUSR1 ' + pid, (error, stdout, stderr) => {
            if (error) {
                debug(stderr);
                throw error;
            }
            console.log(stdout);
        });
    }
    static run(agent) {
        // Check node processes 
        Agent.updateRunningNodeProcesses(agent);
    }
    static processNetStatsResolved(Agent) {
        let interval = setInterval(() => {
            if (Agent.processNetStatsIsResolved) {
                clearInterval(interval);
                return true;
            }
        }, 100);
    }
    static getInspectSocket(Agent, netstats, pid) {
        return new Promise((resolve) => {
            // (async () => {
            //    await processNetStatsResolved(Agent);
            netstats.then(processes => {
                if (os.platform() === 'win32') {
                    processes.forEach((proc, i, processes) => {
                        let array = proc.replace(/\s+/g, ' ').split(' ');
                        if (parseInt(array[4]) === pid) return resolve(array[1]);
                        if (i === processes.length - 1) resolve('A corresponding inspect socket was not found for Node.js process ' + pid);
                    });
                } else {
                    processes.forEach((proc, i, processes) => {
                        let array = proc.replace(/\s+/g, ' ').split(' ');
                        if (parseInt(array[6].split('/')[0]) === pid) return resolve(array[3]);
                        if (i === processes.length - 1) resolve('A corresponding inspect socket was not found for Node.js process ' + pid);
                    });
                }
            });
            // })();
        });
    }
    static updateRunningNodeProcesses(agent) {
        agent.updating = true;
        agent.processNetStatsIsResolved = false;
        agent.processList = {};

        let processNetStats = (() => {
            return new Promise((resolve, reject) => {
                if (os.platform() === 'win32') {
                    exec(`netstat -ano | find "LISTENING"`, (error, stdout, stderr) => {
                        if (error) {
                            debug(stderr);
                            reject(error);
                        }
                        let output = stdout.trim().split(EOL).map(l => l.trim());
                        agent.processNetStatsIsResolved = true;
                        resolve(output);
                    });
                } else {
                    exec('/bin/netstat -lnp | /bin/grep node', (error, stdout, stderr) => {
                        if (error) {
                            debug(stderr);
                            reject(error);
                        }
                        let output = stdout.trim().split(EOL);
                        agent.processNetStatsIsResolved = true;
                        resolve(output);
                    });
                }
            });
        })();

        (async () => {
            let plist = await psList({ processName: 'node.exe' });
            let promises = [];
            plist.forEach((listItem) => {
                if (listItem.name.search(/node(.exe)?\s?/) !== -1) {
                    promises.push(Agent.getInspectSocket(agent, processNetStats, listItem.pid)
                        .then((socket) => {
                            Object.assign(listItem, { nodeInspectFlagSet: (listItem.cmd.search(/--inspect/) === -1) ? false : true, nodeInspectSocket: (listItem.cmd.search(/--inspect/) === -1) ? undefined : socket })
                            Object.assign(agent.processList, { [listItem.pid]: listItem });
                        })
                        .catch((error) => {
                            console.dir(error);
                        }));
                }
            })
            Promise.all(promises)
                .then(() => {
                    console.log('There were ' + Object.keys(agent.processList).length + ' running Node.js processes detected on this host during this check.');
                    console.log('There were ' + Object.values(agent.processList).filter((p) => { return p.nodeInspectFlagSet }).length + ' running Node.js processes detected WITH INSPECT FLAG SET on this host during this check.');
                    //=> [{pid: 3213, name: 'node', cmd: 'node test.js', ppid: 1, cpu: 0.1, memory: 1.5}, …]
                    //console.dir(Agent.processList);
                    agent.updating = false;
                });
        })();
    }

}

let agent = new Agent();
module.exports = agent;

agent.start();
