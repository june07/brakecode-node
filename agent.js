#!/usr/bin/env node

/**
 * MIT License
 *
 *    Copyright (c) 2020-2022 June07
 *
 *    Permission is hereby granted, free of charge, to any person obtaining a copy
 *    of this software and associated documentation files (the "Software"), to deal
 *    in the Software without restriction, including without limitation the rights
 *    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *    copies of the Software, and to permit persons to whom the Software is
 *    furnished to do so, subject to the following conditions:
 *
 *    The above copyright notice and this permission notice shall be included in all
 *    copies or substantial portions of the Software.
 *
 *    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 *    SOFTWARE.
 */
const {
    BRAKECODE_API_KEY,
    QUIET,
    NODE_ENV,
} = process.env;

const fs = require('fs');
const debug = require('debug')('brakecode'),
    debug2 = require('debug')('brakecode:ssh'),
    { exec, execFile } = require('child_process'),
    { join } = require('path'),
    { EOL, homedir, hostname, platform, release, uptime } = require('os'),
    { v5: uuid } = require('uuid'),
    psList = require('@667/ps-list'),
    http = require('http'),
    dns = require('dns').promises,
    yaml = require('js-yaml'),
    which = require('which');
const netstatCommand =
    platform() !== 'win32'
        ? which.sync('netstat', { nothrow: true }) ||
        which.sync('ss', { nothrow: true })
        : 'netstat';

const BRAKECODE_DIR = join(homedir(), '.brakecode'),
    ENV_PATH = join(BRAKECODE_DIR, '.env'),
    CONFIG_PATH = join(BRAKECODE_DIR, 'config.yaml'),
    NAMESPACE_APIKEY_NAME = NODE_ENV?.match(/dev/i)
        ? 'namespace-apikey-dev.brakecode.com'
        : 'namespace-apikey.brakecode.com',
    N2P_HOST = NODE_ENV?.match(/dev/i) ? 'pads-dev.brakecode.com' : 'pads.brakecode.com';
require('dotenv').config({ path: ENV_PATH });
const N2PSocket = require('./N2PSocket.js'),
    SSHKeyManager = require('./SSHKeyManager.js'),
    Watcher = require('./Watcher.js'),
    ssh = require('./src/ssh.js'),
    FILTER_DEPTH = 2; // set to match the number of precoded applications to filter, ie vscode and nodemon
let lookups =
    NODE_ENV?.match(/dev/i)
        ? [NAMESPACE_APIKEY_NAME, 'publickey-dev.brakecode.com']
        : [NAMESPACE_APIKEY_NAME, 'publickey.brakecode.com'];

class Agent {
    constructor(config) {
        this.lookups = lookups;
        this.SSH = new ssh(this);
        this.config = config;
        this.metadata = {
            title: hostname(),
            uuid: uuid(hostname(), 'eb328059-3001-47f0-807a-72a187219dea'),
            host: hostname(),
            content: uptime + ' ' + platform + ' ' + release,
        };
        this.processList = {};
        this.stats = {
            startTime: undefined,
        };
        this.settings = {
            check_interval: 5000,
        };
        this.updating = false;
        this.nsshServerMap = [];
        this.controlSocket = new N2PSocket(this);
        this.SSHKeyManager = new SSHKeyManager(this);
        this.watchers = {};
        this.debuggerURLS = {};
        this.infos = {};

        const tunnelWatcher = agent => {
            agent.updateSSHTunnels();
            return agent;
        };
        Object.assign(this.watchers, {
            tunnel: new Watcher(this, tunnelWatcher, { interval: 5000 }),
        });
        Object.values(this.watchers).forEach(watcher => watcher.start());
    }
    getRunningNodeProcesses() {
        return this.processList;
    }
    start() {
        this.stats.startTime = new Date();
        let check_interval = this.settings.check_interval;

        setInterval(() => {
            Agent.run(this);
        }, check_interval);
    }
    inspectNode(pid) {
        if (Object.values(this.processList).length === 0) return;
        let found = Object.values(this.processList).find(p => p.pid === pid);
        if (!found) return 0;
        let { platform, dockerContainer } = found;
        (function stableAgent() {
            if (!Agent.updating) {
                this.signalProcess(platform, dockerContainer, pid);
            } else {
                setTimeout(stableAgent, 500);
            }
        })();
    }
    formatMetadata(processList) {
        return Object.assign(this.metadata, {
            githubNodejsNodeIssues24085: this.githubNodejsNodeIssues24085,
            connections: processList,
        });
    }
    updateSSHTunnels() {
        const agent = this;

        if (agent.nsshServerMap === undefined || (agent.nsshServerMap && agent.nsshServerMap.length === 0)) return;
        (function stableAgent() {
            if (!agent.updating) {
                Object.values(agent.processList).forEach(async listItem => {
                    if (listItem.inspectPort) {
                        try {
                            const tunnelSocket = await agent.SSH.digTunnel(listItem.inspectPort, listItem.pid);
                            agent.processList[listItem.pid].tunnelSocket = tunnelSocket.socket;
                        } catch (error) {
                            console.log(error);
                        }
                    }
                });
            } else {
                setTimeout(stableAgent, 500);
            }
        })();
    }
    signalProcess(platform, dockerContainer, pid) {
        if (platform === 'win32' && !dockerContainer) {
            return `SIGUSR1 is not available on Windows.  https://nodejs.org/en/docs/guides/debugging-getting-started/`;
        } else if (platform === 'win32' && dockerContainer) {
            // handle docker
            if (!this.processList[pid]) return `PID ${pid} not found.`;
            let found = this.dockerProcesses.find(stdout => {
                let exposedPort = stdout[3].match(/\d.\d.\d.\d:(\d{1,5})/)[1];
                if (exposedPort !== -1 && pid === stdout[4]) return true;
                return false;
            });
            if (!found) return;
            execFile(
                'docker',
                ['exec', found[0], 'kill', '-s', 'SIGUSR1', '1'],
                (error, stdout, stderr) => {
                    if (stderr) {
                        debug2(stderr);
                    }
                    console.log(`signalProcess(): ${stdout}`);
                }
            );
        } else if (platform !== 'win32') {
            // if linux
            exec('/bin/kill -s SIGUSR1 ' + pid, (error, stdout, stderr) => {
                if (stderr) {
                    debug2(stderr);
                    throw error;
                }
                console.log(`signalProcess(): ${stdout}`);
            });
        }
    }
    docker_ps() {
        return new Promise(resolve => {
            execFile(
                'docker',
                [
                    'ps',
                    '--filter',
                    'expose=9229/tcp',
                    '--no-trunc',
                    '--format',
                    '{{.ID}}\t{{.Names}}\t{{.Command}}\t{{.Ports}}',
                ],
                (error, stdout, stderr) => {
                    debug2(stderr);
                    if (error) {
                        return error;
                    }
                    this.dockerProcesses = stdout
                        .split('\n')
                        .filter(line => line)
                        .map(line => {
                            const re = new RegExp('(0.0.0.0:[0-9]*)->9229');
                            let arr = line.split('\t');
                            arr[3] = arr[3].split(',').find(ports => ports.match(re))?.match(re)?.[1];
                            return arr;
                        });
                    resolve();
                }
            );
        });
    }
    async filter(plist) {
        const filters = Object.entries(this.config.filter),
            promises = [];

        promises.push(
            Promise.resolve(
                plist.filter(item => item.cmd.includes('brakecode-agent'))
            )
        );
        filters.forEach(filter => {
            let filterType = filter[0],
                filterValues = filter[1];
            switch (filterType) {
                case 'app':
                    promises.push(
                        new Promise(resolve => {
                            let fStrings,
                                promises2 = [];
                            filterValues.forEach(app => {
                                promises2.push(
                                    new Promise(resolve2 => {
                                        if (app === 'vscode') {
                                            fStrings = ['.vscode-server'];
                                        } else if (app === 'nodemon') {
                                            fStrings = ['nodemon'];
                                        } else if (app === 'pm2') {
                                            fStrings = ['pm2'];
                                        }
                                        fStrings.forEach(fString => {
                                            resolve2(
                                                plist.filter(item =>
                                                    item.cmd.includes(fString)
                                                )
                                            );
                                        });
                                    })
                                );
                            });
                            resolve(Promise.all(promises2));
                        })
                    );
                    break;
                case 'string':
                    promises.push(
                        new Promise(resolve => {
                            filterValues.forEach(fString => {
                                resolve(
                                    plist.filter(item =>
                                        item.cmd.includes(fString)
                                    )
                                );
                            });
                        })
                    );
                    break;
            }
        });
        return Promise.all(promises).then(filtered => {
            filtered.flat(FILTER_DEPTH).map(filteredProcess => {
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
        return new Promise((resolve) => {
            if (platform() === 'win32') {
                resolve(
                    netstats.find((process, i, netstats) => {
                        let array = process.replace(/\s+/g, ' ').split(' ');
                        // array[4] pid, array[1] socket
                        if (parseInt(array[4]) === pid) return array[1];
                        if (i === netstats.length - 1) {
                            return new Error(`A corresponding inspect socket was not found for V8 process ${pid}`);
                        }
                    })
                );
            } else {
                Promise.all(netstats.map((netstat) => {
                    let process = netstat;
                    let foundPId = process.match(/\spid:(.*)/)[1],
                        foundListeningSocket = process.match(/^listening:(.*)\s/)[1];

                    if (parseInt(foundPId) === pid && foundListeningSocket) {
                        return isInspectorProtocol(Agent, pid, foundListeningSocket)
                            .then((ip) => ip && resolve(foundListeningSocket));
                    }
                }))
                    .then(() => resolve(new Error(`A corresponding inspect socket was not found for V8 process ${pid}`)));
            }
        });
    }
    static getTunnelSocket(plist, inspectLocalPort) {
        /* Get's tunnel socket from localhost process list */
        let id = plist
            .filter(listItem => listItem.name === 'ssh')
            .filter(listItem => listItem.cmd.search(/-R/) !== -1)
            .filter(
                listItem => listItem.cmd.search(':' + inspectLocalPort) !== -1
            );
        if (id.length !== 0) {
            let cmd = id[0].cmd;
            let server = cmd.match(/@((.{4,7})\.june07\.com)/)[1];
            let port = parseInt(cmd.split(':')[1]);
            return { server, port };
        }
    }
    static inspectPortOpenOnDockerContainer(error, socket) {
        if (error) return Promise.resolve({ error });
        return new Promise(resolve => {
            let port = parseInt(socket.split(':')[1]);
            let client = http.get(`http://${socket}/json`, res => {
                res.on('data', () => {
                    //debug(`${data}`);
                    client.end();
                });
                res.on('end', () => {
                    resolve({ socket, port });
                });
            });
            client.on('error', error => {
                resolve({ error });
            });
        });
    }
    static async updateRunningNodeProcesses(agent) {
        agent.updating = true;
        agent.processNetStatsIsResolved = false;
        agent.processList = {};

        const processNetStats = await new Promise((resolve, reject) => {
            if (platform() === 'win32') {
                exec(
                    `netstat -ano | find "LISTENING"`,
                    (error, stdout, stderr) => {
                        debug2(stderr);
                        if (error) {
                            reject(error);
                        }
                        let output = stdout
                            .trim()
                            .split(EOL)
                            .map(l => l.trim());
                        agent.processNetStatsIsResolved = true;
                        resolve(output);
                    }
                );
            } else if (netstatCommand.match(/netstat/)) {
                // netstat doesn't output brackets for it's ipv6 output so just disable ipv6 for now... later parse and reformat the output
                exec(
                    `${netstatCommand} -4tlnp | egrep "node|deno" | awk 'BEGIN {FS=" "}{split($7,processInfoArray,"/"); print "listening:"$4" pid:"processInfoArray[1]}'`,
                    (error, stdout, stderr) => {
                        debug2(stderr);
                        if (error) {
                            reject(error);
                        }
                        let output = stdout.trim().split(EOL);
                        agent.processNetStatsIsResolved = true;
                        resolve(output);
                    }
                );
            } else if (netstatCommand.match(/ss/)) {
                exec(
                    `${netstatCommand} -tlnp | egrep "node|deno" | awk 'BEGIN {FS=" "}{split($6,processInfoArray,","); split(processInfoArray[2],pid,"="); print "listening:"$4" pid:"pid[2]}'`,
                    (error, stdout, stderr) => {
                        debug2(stderr);
                        if (error) {
                            reject(error);
                        }
                        agent.processNetStatsIsResolved = true;
                        resolve(stdout.trim().split(EOL));
                    }
                );
            }
        });

        let plist = await psList({ processName: 'node', redact: /adrian/g }),
            plistDeno = await psList({ processName: 'deno', redact: /adrian/g }),
            plistDocker = await psList({ processName: 'docker', redact: /adrian/g });

        let promises = [];
        if (plistDocker.length > 0) await agent.docker_ps();
        if (plist) {
            plist = await agent.filter(plist);
            plist.forEach(listItem => {
                if (isNodeJs(listItem)) {
                    promises.push(
                        Agent.getInspectSocket(
                            agent,
                            processNetStats,
                            listItem.pid
                        ).then(socket => {
                            Object.assign(listItem, {
                                nodeInspectFlagSet:
                                    listItem.cmd.search(/--inspect/) === -1
                                        ? false
                                        : true,
                                nodeInspectSocket:
                                    listItem.cmd.search(/--inspect/) === -1
                                        ? undefined
                                        : socket,
                                inspectPort:
                                    socket instanceof Error
                                        ? undefined
                                        : parseInt(socket.split(':')[1]),
                                tunnelSocket: agent.SSH.getSocket(listItem.pid),
                            });
                            agent.processList[listItem.pid]
                                ? Object.assign(
                                    agent.processList[listItem.pid],
                                    listItem
                                )
                                : (agent.processList[listItem.pid] =
                                    Object.assign({}, listItem));
                        })
                    );
                }
            });
        }
        if (plistDeno.length > 0) await agent.filter(plistDeno);
        plistDeno = await agent.filter(plistDeno);
        plistDeno.forEach(listItem => {
            if (
                listItem.name.search(/deno(.exe)?\s?/) !== -1 &&
                listItem.cmd.search(/^deno|\/deno/) !== -1
            ) {
                promises.push(
                    Agent.getInspectSocket(
                        agent,
                        processNetStats,
                        listItem.pid
                    ).then(socket => {
                        Object.assign(listItem, {
                            nodeInspectFlagSet:
                                listItem.cmd.search(/--inspect/) === -1
                                    ? false
                                    : true,
                            nodeInspectSocket:
                                listItem.cmd.search(/--inspect/) === -1
                                    ? undefined
                                    : socket,
                            inspectPort:
                                socket instanceof Error
                                    ? undefined
                                    : parseInt(socket.split(':')[1]),
                            tunnelSocket: agent.SSH.getSocket(listItem.pid),
                        });
                        agent.processList[listItem.pid]
                            ? Object.assign(
                                agent.processList[listItem.pid],
                                listItem
                            )
                            : (agent.processList[listItem.pid] = Object.assign(
                                {},
                                listItem
                            ));
                    })
                );
            }
        });
        if (plistDocker.length > 0) {
            agent.dockerProcesses.map((dockerProcess, i, dockerProcesses) => {
                const nodeInspectSocket = dockerProcess[3],
                    listItem = {};

                promises.push(
                    Agent.inspectPortOpenOnDockerContainer(
                        null,
                        nodeInspectSocket
                    ).then(({ error, socket, port }) => {
                        if (error) return;
                        Object.assign(listItem, { dockerContainer: true });
                        let processListItem = plistDocker.find(p => {
                            if (p.cmd.match(new RegExp(`-host-port\\s${dockerProcesses[i][3].split(':')[1]}`))) {
                                dockerProcesses[i][1] = p.cmd;
                                return p;
                            }
                        });
                        if (processListItem) {
                            dockerProcesses[i].push(processListItem.pid);
                        }
                        Object.assign(listItem, {
                            nodeInspectFlagSet:
                                dockerProcess[2].search(
                                    /--inspect(?!-port)/
                                ) === -1
                                    ? false
                                    : true,
                            nodeInspectSocket:
                                dockerProcess[2].search(/--inspect/) === -1
                                    ? undefined
                                    : socket,
                            inspectPort:
                                error instanceof Error ? undefined : port,
                            tunnelSocket: agent.SSH.getSocket(
                                processListItem?.pid
                            ),
                        });
                        /* Getting this far doesn't neccessarily mean that we've found a Node.js container.  Must inspect the container to find out for sure and on Windows that's a bit tough because the PPID
                         * of the container isn't on Windows but on the HyperV host Docker creates. */
                        agent.processList[processListItem.pid] = {
                            ...processListItem,
                            ...listItem
                        }
                    })
                );
            });
        }
        await Promise.all(promises).then(() => {
            let totalV8Processes = Object.keys(agent.processList).length,
                totalNodeProcesses = Object.values(agent.processList).filter(
                    process => process.name.match(/node/) || process.cmd.match(/node/)
                ).length,
                totalDenoProcesses = Object.values(agent.processList).filter(
                    process => process.name.match(/deno/) || process.cmd.match(/deno/)
                ).length,
                totalV8ProcessesCalledWithInspectFlag = Object.values(
                    agent.processList
                ).filter(p => {
                    return p.nodeInspectFlagSet;
                }).length,
                totalV8ProcessesRunningOnDocker = Object.values(
                    agent.processList
                ).filter(p => p.dockerContainer).length;
            //if ((!NODE_ENV?.match(/dev/i && (QUIET !== undefined && !QUIET))) || QUIET) console.clear();
            console.log(
                'There were ' +
                totalV8Processes +
                ` running V8 processes detected on this host during the last check (${new Date().toLocaleTimeString()}),
    ${totalV8ProcessesRunningOnDocker}/${totalV8Processes} are running on \x1b[34mDocker\x1b[0m,
    ${totalNodeProcesses}/${totalV8Processes} are running \x1b[32mNode\x1b[0m,
    ${totalDenoProcesses}/${totalV8Processes} are running \x1b[32mDeno\x1b[0m,
    ${totalV8ProcessesCalledWithInspectFlag}/${totalV8Processes} were started with the '--inspect' flag.`
            );

            Object.entries(agent.processList)
                .filter(kv => kv[1].tunnelSocket)
                .map(kv => {
                    const pid = kv[0];
                    const cid = agent?.metadata?.tunnelSockets && agent?.metadata?.tunnelSockets[pid]?.cid;
                    const did = agent.infos[pid]?.id; // Debugger ID
                    const localDevtoolsURL = agent.infos[pid]?.devtoolsFrontendUrl;
                    const params = agent.infos[pid]?.type === 'deno' || agent.infos[pid]?.webSocketDebuggerUrl.match(/wss?:\/\/[^:]*:[0-9]+(\/ws\/)/) ? '?runtime=deno' : '?';

                    if (cid && did) {
                        const remoteDebuggerURL = localDevtoolsURL.replace(/wss?=(.*)/, `wss=${N2P_HOST}/ws/${cid}/${did}${params}`);
                        console.log(`pid: ${pid}, debugger: ${remoteDebuggerURL}`);
                    }
                });
            agent.updating = false;
            let formattedMetadata = agent.formatMetadata(agent.processList);
            //debug(`Formatted metadata: ${JSON.stringify(formattedMetadata)}`);
            if (agent.controlSocket.io)
                agent.controlSocket.io.emit('metadata', formattedMetadata);
        });
    }
}
function isNodeJs(process) {
    const threshold = 2;
    const matches = ['name', 'cmd', 'caption', 'description'].filter(key =>
        process[key]?.search(/node(.exe)?\s?/) === -1 ? false : true
    );

    return matches.length > threshold;
}
function isInspectorProtocol(agent, pid, socket) {
    return new Promise(resolve => {
        http.get(`http://${socket}/json`, res => {
            res.setEncoding('utf8');
            let rawData = '';
            res.on('data', chunk => {
                rawData += chunk;
            });
            res.on('end', () => {
                try {
                    const info = JSON.parse(rawData);
                    agent.infos[pid] = info.pop();
                    resolve(true);
                } catch (error) {
                    debug(error);
                    resolve(false);
                }
            });
        }).on('error', () => {
            resolve(false);
        });
    });
}
async function checkENV() {
    const inquirer = (await import('inquirer')).default;

    if (!fs.existsSync(ENV_PATH)) {
        if (!fs.existsSync(BRAKECODE_DIR)) {
            console.log(
                'Creating Brakecode directory at ' + BRAKECODE_DIR + '...'
            );
            fs.mkdirSync(BRAKECODE_DIR);
        }
        if (!BRAKECODE_API_KEY) {
            return inquirer
                .prompt([
                    {
                        name: 'BRAKECODE_API_KEY',
                        message: 'What is your BRAKECODE_API_KEY',
                        filter: input => {
                            return new Promise(resolve => {
                                resolve(input.trim());
                            });
                        },
                        validate: function (input) {
                            if (
                                !input.match(
                                    /[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}/
                                )
                            )
                                return 'The API Key entered is not valid.';
                            else return null, true;
                        },
                    },
                ])
                .then(answers => {
                    console.log(
                        'Saving environment variables to ' + ENV_PATH + '...'
                    );
                    const configString =
                        Object.entries({
                            NODE_ENV: 'production',
                            ...answers,
                        })
                            .map(item => {
                                // add item to env
                                process.env[item[0]] = `${item[1]}`;
                                // return string config
                                return item[0] + '=' + item[1];
                            })
                            .toString()
                            .replace(',', EOL) + EOL;
                    fs.writeFileSync(ENV_PATH, configString);
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
    if (!fs.existsSync(CONFIG_PATH)) {
        console.log(
            'Creating default configuration file at ' + CONFIG_PATH + '...'
        );
        fs.writeFileSync(CONFIG_PATH, configuration);
    }
    try {
        configuration = await yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8'));
        return Promise.resolve(configuration);
    } catch (error) {
        console.error(error);
    }
}
async function doLookups() {
    await dns.setServers(['1.1.1.1', '8.8.8.8']);
    lookups = await Promise.all(
        lookups.map(lookup => {
            return dns
                .resolve(lookup, 'TXT')
                .then(records => {
                    let key = records[0]
                        ? records[0][0]
                            ? records[0][0]
                            : records[0]
                        : undefined;
                    if (!key) {
                        console.log(new Error(`Error getting ${lookup}.`));
                        process.exit(1);
                    }
                    return { [`${lookup}`]: key };
                })
                .catch(error => {
                    console.log(error.message);
                    process.exit(1);
                });
        })
    );
    lookups.reduce((acc, cur) => {
        acc[`${Object.keys(cur)[0]}`] = Object.values(cur)[0];
    });
    lookups = lookups[0];
}

checkENV()
    .then(doLookups)
    .then(loadConfig)
    .then(config => {
        const agent = new Agent({
            apikeyHashedUUID: uuid(
                BRAKECODE_API_KEY,
                lookups[NAMESPACE_APIKEY_NAME]
            ),
            ...config,
        });

        agent.start();

        module.exports = agent;

        if (NODE_ENV?.match(/dev/i)) global.brakecode = { agent };
    });
