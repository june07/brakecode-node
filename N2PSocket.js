/**
 * MIT License
 *
 *    Copyright (c) 2020 June07
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

const debug = require('debug')('brakecode:N2PSocket.js'),
    { v5: uuid } = require('uuid'),
    nacl = require('tweetnacl'),
    crypto = require('crypto')
;
nacl.util = require('tweetnacl-util');
const SocketIO = require('socket.io-client'),
    N2P_URL = (process.env.DEVEL || process.env.NODE_ENV !== 'production') ? 'https://pads-dev.brakecode.com' : 'https://pads.brakecode.com',
    SSH = require('./src/ssh.js'),
    NAMESPACE_APIKEY_NAME = process.env.NODE_ENV !== 'production' ? 'namespace-apikey-dev.brakecode.com' : 'namespace-apikey.brakecode.com',
    PUBLIC_KEY_NAME = process.env.NODE_ENV !== 'production' ? 'publickey-dev.brakecode.com' : 'publickey.brakecode.com'
; 

class N2PSocket {
    constructor(Agent) {
        let self = this;
        self.Agent = Agent;        
        self.apikeyHashedUUID = uuid(process.env.BRAKECODE_API_KEY, self.Agent.lookups[NAMESPACE_APIKEY_NAME]);
        self.io = SocketIO(N2P_URL + '/' + self.apikeyHashedUUID, {
            query: { apikey: self.encryptMessage(process.env.BRAKECODE_API_KEY) },
            transports: ['websocket'],
            path: '/agent',
            rejectUnauthorized: false
        })
        .on('inspect', args => {
            if (args.uuid !== self.uuid) return;
            console.log('Received inspect command');
            console.dir(args);
            self.Agent.inspectNode(args.nodePID, self.io);
        })
        .on('metadata', data => {
            //debug(data);
        })
        .on('connect_error', error => {
            console.dir(error.message);
        });
        self.ioBroadcast = SocketIO(N2P_URL, { transports: ['websocket'], rejectUnauthorized: false, path: '/agent', query: { apikey: process.env.BRAKECODE_API_KEY } })
        .on('nssh_map', map => {
            Agent.nsshServerMap = map;
        })
        .on('connect_error', error => {
            console.dir(error.message);
        });
    }
    encryptMessage(message) {
        let clientPrivateKey = nacl.randomBytes(32),
            publicKey = nacl.util.decodeBase64(this.Agent.lookups[PUBLIC_KEY_NAME]),
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