#!/usr/bin/env node

/**
 * MIT License
 *
 *    Copyright (c) 2020-2023 June07
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

const debug = require('debug')('brakecode:SSHKeyManager.js'),
    fs = require('fs'),
    { exec } = require('child_process'),
    { join } = require('path'),
    { homedir } = require('os'),
    ID_RSA = join(homedir(), '.ssh/', 'brakecode.id_rsa'),
    ID_RSA_CERT = join(homedir(), '.ssh/', 'brakecode.id_rsa-cert.pub'),
    ID_RSA_COMMENT = 'Generated by Brakecode Agent';

class SSHKeyManager {
    constructor(Agent) {
        this.Agent = Agent;

        (async () => {
            // Check for the keys
            if (ID_RSA !== undefined) {
                // Default key is set.
                this.Agent.key = await this.readPubKeyFile(ID_RSA + '.pub');
            } else if (process.env.ID_RSA !== undefined) {
                // User set key in config file.
                this.Agent.key = await this.readPubKeyFile(process.env.ID_RSA + '.pub');
            } else {
                // Generate if not found.
                this.Agent.key = await this.generateKeyFile();
            }
            this.generateKeyCertificate();
        })();
    }
    async readPubKeyFile(keyfile) {
        try {
            return await fs.readFileSync(keyfile, { encoding: 'utf8' });
        } catch (error) {
            return await this.generateKeyFile();
        }
    }
    async generateKeyFile() {
        const { stdout, stderr } = exec('ssh-keygen -t rsa-sha2-512 -b 4096 -C "' + ID_RSA_COMMENT + '" -N "" -f ' + ID_RSA);
        if (stderr) {
            console.error(stderr);
        }
        debug(stdout);
        const keydata = await this.readKeyFile(ID_RSA);
        return keydata;
    }
    generateKeyCertificate() {
        console.log('Generating Key Certificate...');
        if (this.Agent.controlSocket.io) {
            this.Agent.controlSocket.io.emit('generateSSH_KeyCert', { key: this.Agent.key, principle: this.Agent.config.apikeyHashedUUID.replaceAll('-', '_') })
                .on('SSH_KeyCert', publicKey => {
                    console.log(`Saving Key Certificate to ${ID_RSA_CERT}...`);
                    fs.writeFileSync(ID_RSA_CERT, publicKey, { mode: '0600' });
                    fs.chmodSync(ID_RSA_CERT, '0600'); // The mode option above is not working?!
                });
        }
    }
}

module.exports = SSHKeyManager;