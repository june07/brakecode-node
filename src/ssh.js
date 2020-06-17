const debug = process.env.DEBUG ? require('debug')('brakecode:ssh.js') : error => console.log(error),
  { exec } = require('child_process'),
  { join } = require('path'),
  { homedir } = require('os');
const NIMS_DIR = join(homedir(), '.nims');
const ENV_PATH = join(NIMS_DIR, '.env'),
  SSH_OPTIONS = '-o "ExitOnForwardFailure=yes" -o "StrictHostKeyChecking=accept-new"';
require('dotenv').config({path: ENV_PATH});

class SSH {
  constructor() {
    this.UID = process.env.UID;
    this.NSSH_SERVER = process.env.NSSH_SERVER;
    this.NSSH_SERVER_PORT = process.env.NSSH_SERVER_PORT;
    this.tunnels = {};
  }
  ssh(CMD, options) {
    let self = this;
    return new Promise((resolve, reject) => {
      if (CMD.startsWith('ss.sh')) {
        exec('ssh -p ' + (self.NSSH_SERVER_PORT || 22) + ' ' + self.UID + '@' + self.NSSH_SERVER + ' -i ' + join(homedir(), '.ssh/id_rsa-NiMS' + ' ' + SSH_OPTIONS) + ' ' + CMD, {maxBuffer: 1024 * 500}, (err, stdout, stderr) => {
          if (err) reject(err);
          resolve({err, stdout, stderr});
        });
      } else {
        let sshProcess = exec('ssh -4 -p ' + (self.NSSH_SERVER_PORT || 22) + ' ' + self.UID + '@' + self.NSSH_SERVER + ' -i ' + join(homedir(), '.ssh/id_rsa-NiMS' + ' ' + SSH_OPTIONS) + ' ' + CMD, {maxBuffer: 1024 * 500}, (err, stdout, stderr) => {
          if (err) return reject(stderr);
        });
        self.tunnels[options.pid] = { pid: options.pid, ssh: sshProcess, socket: self.NSSH_SERVER + ":" + options.tunnelPort };
        resolve(options.tunnelPort);
      }
    });
  }
  digTunnel(inspectPort, pid, attempts = 0) {
    let self = this;
    if (self.tunnels[pid] && self.tunnels[pid] !== 'connecting') return Promise.resolve(self.tunnels[pid]);
    else if (self.tunnels[pid] && self.tunnels[pid] === 'connecting') return Promise.reject('connecting');
    return new Promise(resolve => {
      self.tunnels[pid] = 'connecting';
      self.ssh(`ss.sh`)
      .then(connection => {
        self.tunnels[pid] = 'connected';
        let ports = connection.stdout.toString().split(' ');
        let index = Math.floor(ports.length - Math.random() * ports.length);
        let tunnelPort = parseInt(ports[index]);
        return self.ssh(' -T -R *:' + tunnelPort + ':localhost:' + inspectPort, { tunnelPort, pid });
      }).then(tunnelPort => {
        resolve(self.NSSH_SERVER + ":" + tunnelPort);
      }).catch(error => {
        self.tunnels[pid] = 'error';
        debug(error);
        resolve(this.digTunnel(inspectPort, pid, attempts++)); 
      });
    });
  }
  generateKeyPair() {
    let keypair;
    return keypair;
  }
  updateNSSH(servers) {
    this.NSSH_SERVER = servers[0];
  }
  getSocket(pid) {
    return this.tunnels[pid] && typeof this.tunnels[pid] === 'object' ? new TunnelSocket(this.tunnels[pid].socket) : undefined;
  }
  //privateFunction() {}
}

class TunnelSocket {
  constructor(socketString) {
    return {
      socket: socketString,
      host: socketString.split(':')[0],
      port: parseInt(socketString.split(':')[1])
    }
  }
}

//function publicFunction() {}

module.exports = () => {return new SSH()};

/*(() => {
  new SSH().digTunnel('adrian@onezerohosting.com', 9259);
})();*/