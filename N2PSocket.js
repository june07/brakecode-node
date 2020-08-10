const debug = process.env.DEBUG ? require('debug')('brakecode:N2PSocket.js') : error => console.log(error),
    { v5: uuid } = require('uuid'),
    nacl = require('tweetnacl'),
    crypto = require('crypto')
;
nacl.util = require('tweetnacl-util');
const SocketIO = require('socket.io-client'),
    N2P_URL = (process.env.DEBUG || process.env.DEVEL || process.env.NODE_ENV === 'dev') ? 'https://pads-dev.brakecode.com' : 'https://pads.brakecode.com',
    SSH = require('./src/ssh.js')
; 

class N2PSocket {
    constructor(Agent) {
        let self = this;
        self.Agent = Agent;        
        self.apikeyHashedUUID = uuid(process.env.BRAKECODE_API_KEY, self.Agent.lookups['namespace-apikey.brakecode.com']);
        self.io = SocketIO(N2P_URL + '/' + self.apikeyHashedUUID, {
            query: { apikey: self.encryptMessage(process.env.BRAKECODE_API_KEY) },
            transports: ['websocket'],
            path: '/agent'
        })
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
        self.ioBroadcast = SocketIO(N2P_URL, { transports: ['websocket'], path: '/agent', query: { apikey: process.env.BRAKECODE_API_KEY } })
        .on('nssh_map', map => {
            Agent.nsshServerMap = map;
        })
        .on('connect_error', error => {
            console.dir(error.message);
        });
    }
    encryptMessage(message) {
        let clientPrivateKey = nacl.randomBytes(32),
            publicKey = nacl.util.decodeBase64(this.Agent.lookups['publickey.brakecode.com']),
            nonce = crypto.randomFillSync(new Uint8Array(24)),
            keyPair = nacl.box.keyPair.fromSecretKey(clientPrivateKey);
        message = nacl.util.decodeUTF8(JSON.stringify(message));
        let encryptedMessage = nacl.box(message, nonce, publicKey, keyPair.secretKey);
        /**
         * let decryptedMessage = nacl.box.open(encryptedMessage, nonce, publicKey, keyPair.secretKey);
         * console.log(`encrypted: ${nacl.util.encodeBase64(encryptedMessage)}`);
         * console.log(`decrypted: ${nacl.util.encodeUTF8(decryptedMessage)}`);
         * 
         */
        return nacl.util.encodeBase64(nonce) + ' ' + nacl.util.encodeBase64(keyPair.publicKey) + ' ' + nacl.util.encodeBase64(encryptedMessage);
    }
}

module.exports = N2PSocket;