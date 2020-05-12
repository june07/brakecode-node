const debug = process.env.DEBUG ? require('debug')('brakecode:N2PSocket.js') : error => console.log(error),
    { join } = require('path'),
    { homedir } = require('os'),
    SocketIO = require('socket.io-client'),
    N2P_URL = 'https://n2p.june07.com';
const NIMS_DIR = join(homedir(), '.nims');
const ENV_PATH = join(NIMS_DIR, '.env');
const env = require('dotenv').config({path: ENV_PATH});
const SSH = require('./ssh.js')(env);

class N2PSocket {
    constructor(Agent) {
        let self = this;
        self.Agent = Agent;
        self.io = SocketIO(N2P_URL + '/' + process.env.NiMS_API_KEY, { transports: ['websocket'], path: '/nims', query: { uid: process.env.UID } });

        self.io.on('inspect', (args) => {
            if (args.uuid !== self.uuid) return;
            console.log('Received inspect command');
            console.dir(args);
            self.Agent.inspectNode(args.nodePID, self.io);
        })
        .on('nssh servers', (args) => {
            SSH.updateNSSH(args);
            debug(args);
        })
        .on('connect_error', (error) => {
            console.dir(error.message);
        });

    }
}

module.exports = N2PSocket;