const debug = process.env.DEBUG ? require('debug')('brakecode:SSHKeyManager.js') : error => console.log(error),
    fs = require('fs'),
    { exec } = require('child_process'),
    { join } = require('path'),
    { homedir } = require('os'),
    ID_RSA = join(homedir(), '.ssh/', 'id_rsa-NiMS'),
    ID_RSA_COMMENT = 'Generated by NiMS Agent';

class SSHKeyManager {
    constructor(Agent) {
        let self = this;
        self.Agent = Agent;

        new Promise((resolve) => {
            // Check for the keys
            if (ID_RSA !== undefined) {
                // Default key is set.
                self.readPubKeyFile(ID_RSA + '.pub')
                .then((key) => resolve(self.key = key));
            } else if (process.env.ID_RSA !== undefined) {
                // User set key in config file.
                self.readPubKeyFile(process.env.ID_RSA + '.pub')
                .then((key) => resolve(self.key = key));
            } else {
                // Generate if not found.
                self.generateKeyFile()
                .then((key) => resolve(self.key = key));
            }
        })
        .then(() => {
            self.sendKey();
        })
        // Send keys to n2p server.
    }
    readPubKeyFile(keyfile) {
        let self = this;
        return new Promise((resolve) => {
            fs.readFile(keyfile, { encoding: 'utf8'}, (err, data) => {
                if (err) {
                    self.generateKeyFile()
                    .then((keydata) => {
                        resolve(keydata);
                    });
                }
               resolve(data);
            });
        });
    }
    generateKeyFile() {
        return new Promise((resolve, reject) => {
            let sshkeygen = exec('ssh-keygen -t rsa -b 4096 -C "' + ID_RSA_COMMENT + '" -N "" -f ' + ID_RSA, (error, stdout, stderr) => {
                if (error) reject(error);
                return stdout;
            });
        })
        .then((stdout) => {
            console.log(stdout);
            return self.readKeyFile(ID_RSA);
        })
        .then((keydata) => {
            resolve(keydata);
        });
    }
    sendKey() {
        let self = this;
        self.Agent.controlSocket.io.emit('sshkey', { key: self.key });
    }
}

module.exports = SSHKeyManager;