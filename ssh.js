const { exec } = require('child_process'),
  { join } = require('path'),
  { homedir } = require('os'),
  fs = require('fs'),
  os = require('os');
const NIMS_DIR = join(homedir(), '.nims');
const ENV_PATH = join(NIMS_DIR, '.env'),
  SSH_OPTIONS = '-o "ExitOnForwardFailure=yes" -o "StrictHostKeyChecking=accept-new"';
require('dotenv').config({path: ENV_PATH});

class SSH {
  constructor() {
    this.UID = process.env.UID;
    this.NSSH_SERVER = process.env.NSSH_SERVER;
    this.NSSH_SERVER_PORT = process.env.NSSH_SERVER_PORT;
  }
  ssh(CMD) {
    let self = this;
    return new Promise((resolve) => {
      if (CMD.startsWith('ss.sh')) {
        exec('ssh -p ' + (self.NSSH_SERVER_PORT || 22) + ' ' + self.UID + '@' + self.NSSH_SERVER + ' -i ' + join(homedir(), '.ssh/id_rsa-NiMS' + ' ' + SSH_OPTIONS) + ' ' + CMD, {maxBuffer: 1024 * 500}, (err, stdout, stderr) => {
          resolve({err, stdout, stderr}); 
        });
      } else {
        resolve(exec('ssh -p ' + (self.NSSH_SERVER_PORT || 22) + ' ' + self.UID + '@' + self.NSSH_SERVER + ' -i ' + join(homedir(), '.ssh/id_rsa-NiMS' + ' ' + SSH_OPTIONS) + ' ' + CMD, {maxBuffer: 1024 * 500}, (err, stdout, stderr) => {}));
      }
    });
  }
  digTunnel(inspectPort) {
    let self = this;
    return self.ssh('ss.sh')
    .then((connection) => {
      let ports = connection.stdout.toString().split(' ');
      let index = (ports.length > 100) ? 100 : ports.length;
      self.ssh(' -R *:' + ports[index] + ':localhost:' + inspectPort);
      return self.NSSH_SERVER + ":" + ports[index];
    })
    .then((port) => {
      return port;//console.dir(sshProcess);
    });
  }
  generateKeyPair() {
    let keypair;
    return keypair;
  }
  updateNSSH(servers) {
    this.NSSH_SERVER = servers[0];
  }
  privateFunction() {}
}

function publicFunction() {}

module.exports = () => {return new SSH()};

/*(() => {
  new SSH().digTunnel('adrian@onezerohosting.com', 9259);
})();*/