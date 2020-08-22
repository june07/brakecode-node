#!/usr/bin/env node
const fs = require('fs');
const debug = require('debug')('brakecode'),
    { exec, execFile } = require('child_process'),
    { join } = require('path'),
    { EOL, homedir, hostname, platform, release, uptime } = require('os'),
    { v5: uuid } = require('uuid'),
    psList = process.env.NODE_ENV === 'dev' && fs.existsSync('../ps-list') ? require('../ps-list') : require('@667/ps-list'),
    inquirer = require('inquirer'),
    http = require('http'),
    dns = require('dns').promises,
    yaml = require('js-yaml');
const BRAKECODE_DIR = join(homedir(), '.brakecode'),
    ENV_PATH = join(BRAKECODE_DIR, '.env'),
    CONFIG_PATH = join(BRAKECODE_DIR, 'config.yaml'),
    NAMESPACE_APIKEY_NAME = process.env.NODE_ENV === 'dev' ? 'namespace-apikey-dev.brakecode.com' : 'namespace-apikey.brakecode.com'
;
const env = require('dotenv').config({path: ENV_PATH}),
    N2PSocket = require('./N2PSocket.js'),
    SSHKeyManager = require('./SSHKeyManager.js'),
    Watcher = require('./Watcher.js'),
    ssh = require('./src/ssh.js'),
    FILTER_DEPTH = 2 // set to match the number of precoded applications to filter, ie vscode and nodemon
;

let lookups = process.env.NODE_ENV === 'dev' ?
    [ NAMESPACE_APIKEY_NAME, 'publickey-dev.brakecode.com' ] :
    [ NAMESPACE_APIKEY_NAME, 'publickey.brakecode.com' ];

class Agent {
    constructor(config) {
        let self = this;
        self.lookups = lookups;
        self.SSH = new ssh(self);
        self.config = config;
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
        self.nsshServerMap = [];

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
        if (self.nsshServerMap === undefined || (self.nsshServerMap && self.nsshServerMap.length === 0)) return;
        return new Promise((resolve) => {
            (function stableAgent() {
                if (! Agent.updating) {
                    Object.values(self.processList).forEach(listItem => {
                        if (!listItem.inspectPort) return resolve();
                        self.SSH.digTunnel(listItem.inspectPort, listItem.pid)
                        .then(tunnelSocket => {
                            self.processList[listItem.pid].tunnelSocket = tunnelSocket.socket;
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
                console.log(`signalProcess(): ${stdout}`);
            });
        } else if (platform !== 'win32') {
            // if linux
            exec('/bin/kill -s SIGUSR1 ' + pid, (error, stdout, stderr) => {
                if (error) {
                    debug(stderr);
                    throw error;
                }
                console.log(`signalProcess(): ${stdout}`);
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
    async filter(plist) {
        let self = this,
            filters = Object.entries(self.config.filter),
            promises = [];
        
        promises.push(Promise.resolve(plist.filter(item => item.cmd.includes('brakecode-agent'))));
        filters.forEach(filter => {
            let filterType = filter[0],
                filterValues = filter[1];
            switch(filterType) {
                case 'app':
                    promises.push(new Promise(resolve => {
                        let fStrings,
                            promises2 = [];
                        filterValues.forEach(app => {
                            promises2.push(new Promise(resolve2 => {
                                if (app === 'vscode') {
                                    fStrings = [
                                        '.vscode-server'
                                    ]
                                } else if (app === 'nodemon') {
                                    fStrings = [ 'nodemon' ]
                                } else if (app === 'pm2') {
                                    fStrings = [ 'pm2' ]
                                }
                                fStrings.forEach(fString => {
                                    resolve2(plist.filter(item => item.cmd.includes(fString)));
                                });
                            }));
                        });
                        resolve(Promise.all(promises2));
                    })); break;
                case 'string':
                    promises.push(new Promise(resolve => {
                        filterValues.forEach(fString => {
                            resolve(plist.filter(item => item.cmd.includes(fString)));
                        });
                    })); break;
            }
        });
        return Promise.all(promises)
        .then(filtered => {
            filtered = filtered.flat(FILTER_DEPTH).map(filteredProcess => {
                let index = plist.findIndex(p => p.pid === filteredProcess.pid);
                plist.splice(index, 1);
            });
            return plist;
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
        return new Promise(resolve => {
            netstats.then(processes => {
                if (platform() === 'win32') {
                    processes.forEach((proc, i, processes) => {
                        let array = proc.replace(/\s+/g, ' ').split(' ');
                        if (parseInt(array[4]) === pid) return resolve(array[1]);
                        if (i === processes.length - 1) resolve('A corresponding inspect socket was not found for Node.js process ' + pid);
                    });
                } else {
                    (async () => {
                        for (let i = 0; i < processes.length; i++) {
                            let proc = processes[i];
                            let array = proc.replace(/\s+/g, ' ').split(' ');
                            if (parseInt(array[6].split('/')[0]) === pid) {
                                let ip = await isInspectorProtocol(array[3]);
                                if (ip) {
                                    return resolve(array[3]);
                                } else {
                                    return resolve(new Error('A corresponding inspect socket was not found for Node.js process ' + pid));
                                }
                            }
                        }
                        resolve(new Error('No listening socket was not found for Node.js process ' + pid));
                    })();
                }
            });
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
            if (plistDocker.length > 0) await agent.docker_ps();
            plist = await agent.filter(plist);
            plist.forEach(listItem => {
                if (listItem.name.search(/node(.exe)?\s?/) !== -1 && listItem.cmd.search(/^node/) !== -1) {
                    promises.push(Agent.getInspectSocket(agent, processNetStats, listItem.pid)
                        .then(socket => {
                            Object.assign(listItem, {
                                nodeInspectFlagSet: (listItem.cmd.search(/--inspect/) === -1) ? false : true,
                                nodeInspectSocket: (listItem.cmd.search(/--inspect/) === -1) ? undefined : socket,
                                inspectPort: (socket instanceof Error) ? undefined : parseInt(socket.split(':')[1]),
                                tunnelSocket: agent.SSH.getSocket(listItem.pid)
                            });
                            agent.processList[listItem.pid] ? Object.assign(agent.processList[listItem.pid], listItem) : agent.processList[listItem.pid] = Object.assign({}, listItem);
                        })
                        .catch(error => {
                            console.dir(error);
                        }));
                }
            });
            if (plistDocker.length > 0) agent.dockerProcesses.map((dockerProcess, i, dockerProcesses) => {
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
                            tunnelSocket: agent.SSH.getSocket(processListItem.pid)
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
                    if (agent.controlSocket.io) agent.controlSocket.io.emit('metadata', formattedMetadata);
                });
        })();
    }
}
function isInspectorProtocol(socket) {
    return new Promise(resolve => {
        let ip = false;
        let client = http.get(`http://${socket}/json`, res => {
                res.on('data', data => {
                    //debug(`${data}`);
                    try {
                        JSON.parse(data);
                        ip = true;
                    } catch (error) {
                    //debug(error);
                    }
                    client.end();
                });
                res.on('end', () => {
                    resolve(ip);
                });
            });
    });
}
function checkENV() {
    if (! fs.existsSync(ENV_PATH)) {
        if (! fs.existsSync(BRAKECODE_DIR)) {
            console.log('Creating Brakecode directory at ' + BRAKECODE_DIR + '...');
            fs.mkdirSync(BRAKECODE_DIR);
        }
        if (! process.env.BRAKECODE_API_KEY) {
            return inquirer
            .prompt([
                {
                    name: 'BRAKECODE_API_KEY',
                    message: 'What is your BRAKECODE_API_KEY',
                    filter: (input) => {
                        return new Promise(resolve => {
                            resolve(input.trim());
                        });
                    },
                    validate: function(input) {
                        if (! input.match(/[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}/)) return('The API Key entered is not valid.');
                        else return(null, true);
                    }
                }
            ])
            .then(answers => {
                console.log('Saving environment variables to ' + ENV_PATH + '...');
                fs.writeFileSync(ENV_PATH, Object.entries(answers).map(item => item[0] + '=' + item[1]).toString().replace(',', EOL) + EOL);
                Object.entries(answers).map(item => process.env[item[0]]=`${item[1]}`);
                Promise.resolve();
            });
        } else {
            return Promise.resolve();
        }
    } else {
        return Promise.resolve();
    }
}
async function loadConfig() {
    let configuration = `
---
filter:
    app:
        - vscode
        - nodemon
        - pm2
    string:
        - random string
`;
    if (! fs.existsSync(CONFIG_PATH)) {
        console.log('Creating default configuration file at ' + CONFIG_PATH + '...');
        fs.writeFileSync(CONFIG_PATH, configuration);
    }
    try {
        configuration = await yaml.safeLoad(fs.readFileSync(CONFIG_PATH, 'utf8'));
        return Promise.resolve(configuration);
    } catch(error) {
        debug(error);
    }
}
async function doLookups() {
    await dns.setServers(['1.1.1.1', '8.8.8.8']);
    lookups = await Promise.all(lookups.map(lookup => {
        return dns.resolve(lookup, 'TXT')
        .then(records => {
            let key = records[0] ? records[0][0] ? records[0][0] : records[0] : undefined;
            if (!key) {
                console.log(new Error(`Error getting ${lookup}.`));
                process.exit(1);
            }
            return { [`${lookup}`]: key };
        })
        .catch(error => {
            debug(error);
            console.log(error.message);
            process.exit(1);
        });
    }));
    lookups.reduce((acc, cur) => { acc[`${Object.keys(cur)[0]}`] = Object.values(cur)[0] });
    lookups = lookups[0];
}

checkENV()
.then(doLookups)
.then(loadConfig)
.then(config => {
    let agent = new Agent(config);
    agent.apikeyHashedUUID = uuid(process.env.BRAKECODE_API_KEY, lookups[NAMESPACE_APIKEY_NAME]);
    module.exports = agent;

    agent.start();

    if (process.env.NODE_ENV === 'dev') global.brakecode = { agent }
});
