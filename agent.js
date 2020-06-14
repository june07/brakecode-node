const debug = process.env.DEBUG ? require('debug')('brakecode') : error => console.log(error),
    fs = require('fs'),
    { exec, execFile } = require('child_process'),
    { join } = require('path'),
    { EOL, homedir, hostname, platform, release, uptime } = require('os'),
    { v5: uuid } = require('uuid'),
    psList = process.env.NODE_ENV === 'dev' ? require('../ps-list') : require('@667/ps-list'),
    inquirer = require('inquirer'),
    http = require('http');
const BRAKECODE_DIR = join(homedir(), '.brakecode');
const NIMS_DIR = join(homedir(), '.nims');
const ENV_PATH = join(NIMS_DIR, '.env');
const N2PSocket = require('./N2PSocket.js'),
    SSHKeyManager = require('./SSHKeyManager.js'),
    Watcher = require('./Watcher.js'),
    SSH = require('./src/ssh.js')();

class Agent {
    constructor() {
        let self = this;
        self.metadata = {
            title: hostname(),
            uuid: uuid(hostname(), 'eb328059-3001-47f0-807a-72a187219dea'),
            host: hostname(),
            content: uptime + ' ' + platform + ' ' + release
        }
        self.processList = {};
        self.stats = {
            startTime: undefined
        };
        self.settings = {
            check_interval: 5000
        };
        self.updating = false;

        if (process.env.BRAKECODE_API_KEY) {
            try {
                if (fs.statSync(BRAKECODE_DIR).isDirectory()) {
                    fs.writeFileSync(join(BRAKECODE_DIR, '.env'), 'BRAKECODE_API_KEY=' + process.env.BRAKECODE_API_KEY);
                }
            } catch(error) {
                fs.mkdirSync(BRAKECODE_DIR);
                fs.writeFileSync(join(BRAKECODE_DIR, '.env'), 'BRAKECODE_API_KEY=' + process.env.BRAKECODE_API_KEY);
            }
        }
        self.controlSocket = new N2PSocket(self);
        self.SSHKeyManager = new SSHKeyManager(self);
        self.watchers = {};

        function tunnelWatcher(self) {
            self.checkSSHTunnels();
            return this;
        }
        Object.assign(self.watchers, {'tunnel': new Watcher(this, tunnelWatcher, { interval: 5000 })});
        (function startWatchers() {
            Object.values(self.watchers).forEach((watcher) => watcher.start());
        })();
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
        let self = this;
        if (Object.values(self.processList).length === 0) return;
        let found = Object.values(self.processList).find(p => p.pid === pid);
        if (!found) return 0;
        let { platform, dockerContainer } = found;
        (function stableAgent() {
            if (!Agent.updating) {
                self.signalProcess(platform, dockerContainer, pid);
            } else {
                setTimeout(stableAgent, 500);
            }
        })();
    }
    formatMetadata(processList) {
        let self = this;
        return Object.assign(self.metadata, {
            githubNodejsNodeIssues24085: self.githubNodejsNodeIssues24085,
            connections: processList
        });
    }
    checkSSHTunnels() {
        let self = this;
        return new Promise((resolve) => {
            (function stableAgent() {
                if (! Agent.updating) {
                    Object.values(self.processList).forEach(listItem => {
                        if (!listItem.inspectPort) return resolve();
                        SSH.digTunnel(listItem.inspectPort, listItem.pid)
                        .then(tunnelSocket => {
                            self.processList[listItem.pid].tunnelSocket = tunnelSocket;
                            resolve(tunnelSocket);
                        })
                        .catch(error => {
                            resolve(error);
                        });
                    });
                } else {
                    setTimeout(stableAgent, 500);
                }
            })();
        });
    }            
    signalProcess(platform, dockerContainer, pid) {
        let self = this;
        if (platform === 'win32' && ! dockerContainer) {
            let msg = `SIGUSR1 is not available on Windows.  https://nodejs.org/en/docs/guides/debugging-getting-started/`;
            debug(msg);
            return msg;
        } else if (platform === 'win32' && dockerContainer) {
            // handle docker
            if (!self.processList[pid]) return `PID ${pid} not found.`;
            let found = self.dockerProcesses.find(stdout => {
                let exposedPort = stdout[3].match(/\d.\d.\d.\d:(\d{1,5})/)[1];
                if (exposedPort !== -1 && pid === stdout[4]) return true;
                return false;
            });
            if (!found) return;
            execFile('docker', ['exec', found[0], 'kill', '-s', 'SIGUSR1', '1'], (error, stdout, stderr) => {
                if (error) {
                    debug(stderr);
                }
                console.log(stdout);
            });
        } else if (platform !== 'win32') {
            // if linux
            exec('/bin/kill -s SIGUSR1 ' + pid, (error, stdout, stderr) => {
                if (error) {
                    debug(stderr);
                    throw error;
                }
                console.log(stdout);
            });
        }
    }
    docker_ps() {
        let self = this;
        return new Promise(resolve => {
            execFile('docker', ['ps', '--filter', 'expose=9229/tcp', '--no-trunc', '--format', '{{.ID}}\t{{.Names}}\t{{.Command}}\t{{.Ports}}'], (error, stdout, stderr) => {
                if (error) {
                    debug(error);
                    return error;
                }
                self.dockerProcesses = stdout.split('\n').filter(line => line).map(line => line.split('\t'));
                resolve();
            });
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
                if (platform() === 'win32') {
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
    static getDockerInspectSocket(Agent, netstats, dockerPort) {
        return new Promise(resolve => {
            netstats.then(processes => {
                processes.forEach((proc, i, processes) => {
                    let socket = proc.replace(/\s+/g, ' ').split(' ').find(socket => socket.match(/\d.\d.\d.\d:(\d{1,5})/));
                    let port = socket ? socket.split(':')[1] : undefined;
                    if (port !== undefined && port === dockerPort) return resolve(socket);
                    if (i === processes.length - 1) resolve('Docker container process inspect socket was not found for Node.js process on Docker host socket ' + socket);
                });
            });
        });
    }
    static getTunnelSocket(plist, inspectLocalPort) {
        /* Get's tunnel socket from localhost process list */
        let id = plist.filter((listItem) => listItem.name === 'ssh').filter((listItem) => listItem.cmd.search(/-R/) !== -1).filter((listItem) => listItem.cmd.search(':'+inspectLocalPort) !== -1);
        if (id.length !== 0) {
            let cmd = id[0].cmd;
            let server = cmd.match(/@((.{4,7})\.june07\.com)/)[1];
            let port = parseInt(cmd.split(':')[1]);
            return({server, port}); 
        }
    }
    static inspectPortOpenOnDockerContainer(socket) {
        return new Promise(resolve => {
            let port = parseInt(socket.split(':')[1]);
            let client = http.get(`http://${socket}/json`, res => {
                res.on('data', data => {
                    //debug(`${data}`);
                    client.end();
                });
                res.on('end', () => {
                    resolve({ socket, port });
                });
            });
            client.on('error', error => { resolve({error}) });
        });
    }
    static updateRunningNodeProcesses(agent) {
        agent.updating = true;
        agent.processNetStatsIsResolved = false;
        agent.processList = {};

        let processNetStats = (() => {
            return new Promise((resolve, reject) => {
                if (platform() === 'win32') {
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
            let plist = await psList({ processName: 'node' }),
                plistDocker = await psList({ processName: 'docker' });
            let promises = [];
            await agent.docker_ps();
            plist.forEach((listItem) => {
                if (listItem.name.search(/node(.exe)?\s?/) !== -1) {
                    promises.push(Agent.getInspectSocket(agent, processNetStats, listItem.pid)
                        .then((socket) => {
                            Object.assign(listItem, {
                                nodeInspectFlagSet: (listItem.cmd.search(/--inspect/) === -1) ? false : true,
                                nodeInspectSocket: (listItem.cmd.search(/--inspect/) === -1) ? undefined : socket,
                                inspectPort: (socket instanceof Error) ? undefined : parseInt(socket.split(':')[1]),
                                tunnelSocket: SSH.getSocket(listItem.pid)
                            });
                            agent.processList[listItem.pid] ? Object.assign(agent.processList[listItem.pid], listItem) : agent.processList[listItem.pid] = Object.assign({}, listItem);
                        })
                        .catch((error) => {
                            console.dir(error);
                        }));
                }
            });
            agent.dockerProcesses.map((dockerProcess, i, dockerProcesses) => {
                let nodeInspectPort = dockerProcess[3].match(/\d.\d.\d.\d:(\d{1,5})/)[1],
                    listItem = {};
                promises.push(Agent.getDockerInspectSocket(agent, processNetStats, nodeInspectPort)
                    .then(socket => {
                        return Agent.inspectPortOpenOnDockerContainer(socket);
                    })
                    .then(({error, socket, port}) => {
                        Object.assign(listItem, { dockerContainer: true });
                        let processListItem = plistDocker.find(p => {
                            if (p.name.search(/^docker(?!-)(.exe)?\s?/) !== -1) {
                                let nameFlagFromCommandLine = p.cmd.match(/--name\s+([^-\s]+)/)[1];
                                if (nameFlagFromCommandLine !== -1 && dockerProcess[1] === nameFlagFromCommandLine) return p;
                            }
                        });
                        if (processListItem !== -1) {
                            dockerProcesses[i].push(processListItem.pid);
                        }
                        Object.assign(listItem, {
                            nodeInspectFlagSet: (dockerProcess[2].search(/--inspect(?!-port)/) === -1) ? false : true,
                            nodeInspectSocket: (dockerProcess[2].search(/--inspect/) === -1) ? undefined : socket,
                            inspectPort: (error instanceof Error) ? undefined : port,
                            tunnelSocket: SSH.getSocket(processListItem.pid)
                        }); 
                        /* Getting this far doesn't neccessarily mean that we've found a Node.js container.  Must inspect the container to find out for sure and on Windows that's a bit tough because the PPID
                            * of the container isn't on Windows but on the HyperV host Docker creates. */
                        Object.assign(agent.processList, { [processListItem.pid]: Object.assign(processListItem, listItem) });
                    })
                    .catch(error => {
                        console.dir(error);
                    }));
            });
            Promise.all(promises)
                .then(() => {
                    let totalNodeProcesses = Object.keys(agent.processList).length,
                        totalNodeProcessesCalledWithInspectFlag = Object.values(agent.processList).filter((p) => { return p.nodeInspectFlagSet }).length,
                        totalNodeProcessesRunningOnDocker = Object.values(agent.processList).filter((p) => p.dockerContainer).length;
                    console.log('There were ' + totalNodeProcesses + ` running Node processes detected on this host during this check,
    ${totalNodeProcessesRunningOnDocker}/${totalNodeProcesses} are running on Docker 🐋,
    ${totalNodeProcessesCalledWithInspectFlag}/${totalNodeProcesses} were started with '--inspect'.`);
                    agent.updating = false;
                    let formattedMetadata = agent.formatMetadata(agent.processList);
                    //debug(`Formatted metadata: ${JSON.stringify(formattedMetadata)}`);
                    agent.controlSocket.io.emit('metadata', formattedMetadata);
                });
        })();
    }
}

function checkENV() {
    if (! fs.existsSync(ENV_PATH)) {
        if (! fs.existsSync(NIMS_DIR)) {
            console.log('Creating NiMS directory at ' + NIMS_DIR + '...');
            fs.mkdirSync(NIMS_DIR);
        }
        return inquirer
        .prompt([
            // Question 1
            {
                name: 'NiMS_API_KEY',
                message: 'What is your NiMS_API_KEY',
                filter: (input) => {
                    return new Promise(resolve => {
                        resolve(input);
                    });
                }
            },
            {
                name: 'UID',
                message: 'What is your NiMS UID',
                filter: (input) => {
                    return new Promise(resolve => {
                        resolve(input);
                    });
                }
            }
        ])
        .then(answers => {
            console.log('Saving environment variables to ' + ENV_PATH + '...')
            fs.writeFileSync(ENV_PATH, Object.entries(answers).map(item => item[0] + '=' + item[1]).toString().replace(',', EOL) + EOL);
        });
    } else {
        return Promise.resolve();
    }
}

checkENV()
.then(() => {
    let agent = new Agent();
    module.exports = agent;

    agent.start();

    if (process.env.NODE_ENV === 'dev') global.brakecode = { agent }
});
