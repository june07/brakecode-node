const { exec } = require('child_process'),
  path = require('path'),
  fs = require('fs'),
  os = require('os'),

  SSH_OPTIONS = '-o "ExitOnForwardFailure=yes" -o "StrictHostKeyChecking=accept-new"';

class SSH {
  constructor(env) {
    this.env = env;
    this.UID = env.UID;
    this.NSSH_SERVER = env.NSSH_SERVER;
    this.NSSH_SERVER_PORT = env.NSSH_SERVER_PORT;
  }
  ssh(CMD) {
    let self = this;
    return new Promise((resolve) => {
      if (CMD.startsWith('ss.sh')) {
        exec('ssh -p ' + (self.NSSH_SERVER_PORT || 22) + ' ' + self.UID + '@' + self.NSSH_SERVER + ' -i ' + path.join(os.homedir(), '.ssh/id_rsa-NiMS' + ' ' + SSH_OPTIONS) + ' ' + CMD, {maxBuffer: 1024 * 500}, (err, stdout, stderr) => {
          resolve({err, stdout, stderr}); 
        });
      } else {
        resolve(exec('ssh -p ' + (self.NSSH_SERVER_PORT || 22) + ' ' + self.UID + '@' + self.NSSH_SERVER + ' -i ' + path.join(os.homedir(), '.ssh/id_rsa-NiMS' + ' ' + SSH_OPTIONS) + ' ' + CMD, {maxBuffer: 1024 * 500}, (err, stdout, stderr) => {}));
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

module.exports = (env) => {return new SSH(env)};

/*(() => {
  new SSH().digTunnel('adrian@onezerohosting.com', 9259);
})();*/