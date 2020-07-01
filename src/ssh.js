const debug = process.env.DEBUG ? require('debug')('brakecode:ssh.js') : error => console.log(error),
  { exec } = require('child_process'),
  { join } = require('path'),
  { homedir } = require('os');
const NIMS_DIR = join(homedir(), '.nims');
const ENV_PATH = join(NIMS_DIR, '.env'),
  SSH_OPTIONS = '-o "ExitOnForwardFailure=yes" -o "StrictHostKeyChecking=accept-new" -o "ConnectTimeout=5"',
  ID_RSA = join(homedir(), '.ssh/', 'brakecode.id_rsa'),
  ID_RSA_CERT = join(homedir(), '.ssh/', 'brakecode.id_rsa-cert.pub');
require('dotenv').config({ path: ENV_PATH });

class SSH {
  constructor() {
    this.UID = process.env.UID;
    this.NSSH_SERVER = process.env.NSSH_SERVER || 'nssh.brakecode.com';
    this.NSSH_SERVER_PORT = process.env.NSSH_SERVER_PORT || 22222;
    this.NSSH_SERVER_TIMEOUT = process.env.NSSH_SERVER_TIMEOUT || 30000;
    this.tunnels = {};
  }
  ssh(CMD, options) {
    let self = this;
    return new Promise((resolve, reject) => {
      if (CMD.startsWith('ss.sh')) {
        exec('ssh -p ' + (self.NSSH_SERVER_PORT) + ' ' + self.UID + '@' + self.NSSH_SERVER + ' -i ' + ID_RSA + ' -i ' + ID_RSA_CERT + ' ' + SSH_OPTIONS + ' ' + CMD, { maxBuffer: 1024 * 500 }, (err, stdout, stderr) => {
          if (err) return reject(err);
          resolve({ err, stdout, stderr });
        });
      } else {
        let promises = [ new Promise(resolve => { setTimeout(resolve, self.NSSH_SERVER_TIMEOUT, new Error('timed out')) }) ];
        let nsshServerPromise;
        let sshProcess = exec('ssh -v -4 -p ' + (self.NSSH_SERVER_PORT) + ' ' + self.UID + '@' + self.NSSH_SERVER + ' -i ' + ID_RSA + ' -i ' + ID_RSA_CERT + ' ' + SSH_OPTIONS + ' ' + CMD, { maxBuffer: 1024 * 500 }, (err, stdout, stderr) => {
          if (err) return reject(stderr);
        });
        sshProcess.on('close', close => {
          self.tunnels[options.pid].state = 'closed';
        });
        sshProcess.stderr.on('data', data => {
          promises.push(new Promise(resolve => {
            let nsshServer = data.match(/nsshost\s(nssh0*([0-9]|[1-8][0-9]|9[0-9]|[1-8][0-9]{2}|9[0-8][0-9]|99[0-9]).brakecode.com)/, 'g');
            debug(nsshServer);
            if (nsshServer && nsshServer.length > 0) resolve(nsshServer[1]);
          }));
        });
        sshProcess.stdout.on('data', data => { 
          Promise.race(promises)
          .then(nsshServer => {
            if (nsshServer instanceof Error) {
              return reject(nsshServer);
            }
            self.tunnels[options.pid] = {
              pid: options.pid,
              ssh: sshProcess,
              socket: nsshServer + ":" + options.tunnelPort,
              state: 'connected'
            };
            resolve(self.tunnels[options.pid].socket);
          });
        });
      }
    });
  }
  digTunnel(inspectPort, pid, retry = 0) {
    let self = this;
    if (self.tunnels[pid] && self.tunnels[pid].state === 'connected') return Promise.resolve(self.tunnels[pid]);
    else if (self.tunnels[pid] && self.tunnels[pid].state === 'connecting') return Promise.reject(self.tunnels[pid].state);
    else if (self.tunnels[pid] && self.tunnels[pid].state === 'retrying' && retry === 0) return Promise.reject(self.tunnels[pid].state);
    return new Promise(resolve => {
      self.tunnels[pid] = { ['state']: 'connecting' };
      self.ssh(`ss.sh`)
        .then(connection => {
          self.tunnels[pid].state = 'connected';
          let ports = connection.stdout.toString().split(' ');
          let index = Math.floor(ports.length - Math.random() * ports.length);
          let tunnelPort = parseInt(ports[index]);
          return self.ssh(' -T -R *:' + tunnelPort + ':localhost:' + inspectPort, { tunnelPort, pid });
        }).then(tunnelSocket => {
          resolve(tunnelSocket);
        }).catch(error => {
          self.tunnels[pid].state = 'retrying';
          debug(error.message);
          if (retry > 3) {
            self.tunnels[pid].state = 'error';
            return self.tunnels[pid].state;
          }
          let milliseconds = 1000 * (retry + 1) * 10;
          debug(`Waiting ${milliseconds / 1000} seconds between retry...`);
          setTimeout(() => {
            resolve(self.digTunnel(inspectPort, pid, ++retry));
          }, milliseconds)
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
    return this.tunnels[pid] && this.tunnels[pid].socket ? new TunnelSocket(this.tunnels[pid].socket) : undefined;
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

module.exports = () => { return new SSH() };

/*(() => {
  new SSH().digTunnel('adrian@onezerohosting.com', 9259);
})();*/