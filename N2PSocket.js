const debug = process.env.DEBUG ? require('debug')('brakecode:N2PSocket.js') : error => console.log(error),
    { join } = require('path'),
    { homedir } = require('os'),
    SocketIO = require('socket.io-client'),
    N2P_URL = (process.env.DEBUG || process.env.DEVEL || process.env.NODE_ENV === 'dev') ? 'https://n2p-dev.brakecode.com' : 'https://n2p.brakecode.com',
    SSH = require('./src/ssh.js');
; 

class N2PSocket {
    constructor(Agent) {
        let self = this;
        self.Agent = Agent;
        self.io = SocketIO(N2P_URL + '/' + process.env.BRAKECODE_API_KEY, { transports: ['websocket'], path: '/nims', query: { apikey: process.env.BRAKECODE_API_KEY } })
            .on('inspect', args => {
                if (args.uuid !== self.uuid) return;
                console.log('Received inspect command');
                console.dir(args);
                self.Agent.inspectNode(args.nodePID, self.io);
            })
            .on('metadata', data => {
                debug(data);
            })
            .on('connect_error', error => {
                console.dir(error.message);
            });
        self.ioBroadcast = SocketIO(N2P_URL, { transports: ['websocket'], path: '/nims', query: { apikey: process.env.BRAKECODE_API_KEY } })
            .on('nssh_map', map => {
                Agent.nsshServerMap = map;
            })
            .on('connect_error', error => {
                console.dir(error.message);
            });
    }
}

module.exports = N2PSocket;