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

const debug = require('debug')('brakecode:ssh.js'),
  { exec } = require('child_process'),
  { join } = require('path'),
  { homedir } = require('os')
  ;
const SSH_OPTIONS = [
  `-o "ExitOnForwardFailure=yes"`,
  `-o "StrictHostKeyChecking=accept-new"`,
  `-o "ConnectTimeout=5"`,
  `-o "ServerAliveInterval=20"`
].join(' '),
  ID_RSA = join(homedir(), '.ssh/', 'brakecode.id_rsa'),
  ID_RSA_CERT = join(homedir(), '.ssh/', 'brakecode.id_rsa-cert.pub')
  ;

class SSH {
  constructor(Agent) {
    this.Agent = Agent;
    this.BRAKECODE_API_KEY = process.env.BRAKECODE_API_KEY;
    this.NSSH_SERVER = process.env.NSSH_SERVER || 'nssh.brakecode.com';
    this.NSSH_SERVER_PORT = process.env.NSSH_SERVER_PORT || 22667;
    this.NSSH_SERVER_TIMEOUT = process.env.NSSH_SERVER_TIMEOUT || 30000;
    this.TUNNEL_RECORDS_REMOVAL_INTERVAL = process.env.TUNNEL_RECORDS_REMOVAL_INTERVAL || 600;
    this.tunnels = {};
    this.intervals = {
      removeOldTunnelRecords: setInterval(this.removeOldTunnelRecords.bind(this), this.TUNNEL_RECORDS_REMOVAL_INTERVAL)
    }
    this.Agent;
  }
  removeOldTunnelRecords() {
    Object.entries(this.tunnels).forEach(kv => {
      if (kv[1].state === 'closed') delete this.tunnels[kv[0]];
    });
  }
  ssh(CMD, options) {
    let self = this;
    return new Promise((resolve, reject) => {
      if (CMD.startsWith('ss.sh')) {
        exec('ssh -p ' + self.NSSH_SERVER_PORT + ' "' + self.Agent.apikeyHashedUUID + '"@' + self.NSSH_SERVER + ' -i ' + ID_RSA + ' -i ' + ID_RSA_CERT + ' ' + SSH_OPTIONS + ' -T', { maxBuffer: 1024 * 500 }, (err, stdout, stderr) => {
          debug(err, stdout, stderr);
          if (stdout.includes('unused ports:')) return resolve({ err, stdout, stderr });
          else if (err) return reject(err);
        });
      } else {
        let timeoutId;
        [new Promise(resolve => { timeoutId = setTimeout(resolve, self.NSSH_SERVER_TIMEOUT, new Error('timed out')) })];
        let sshProcess = exec('ssh -v -4 -p ' + self.NSSH_SERVER_PORT + ' "' + self.Agent.apikeyHashedUUID + '"@' + self.NSSH_SERVER + ' -i ' + ID_RSA + ' -i ' + ID_RSA_CERT + ' ' + SSH_OPTIONS + ' ' + CMD, { maxBuffer: 1024 * 500 }, (err, stdout, stderr) => {
          if (err) return reject(stderr);
        });
        sshProcess.on('close', () => {
          if (self.tunnels[options.pid]) self.tunnels[options.pid].state = 'closed';
        });
        sshProcess.stderr.on('data', data => {
          let nsshServerUUID = data.match(/nsshost\s([0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12})/i);
          if (nsshServerUUID && nsshServerUUID.length > 0) nsshServerUUID = nsshServerUUID[1];
          if (nsshServerUUID) {
            clearTimeout(timeoutId);
            debug(nsshServerUUID);
            if (nsshServerUUID instanceof Error) {
              return reject(nsshServerUUID);
            }
            let nsshServer = self.Agent.nsshServerMap.find(server => server.uuid === nsshServerUUID);
            if (nsshServer === undefined) return reject(new Error(`Mapping missing for nssh server: ${nsshServerUUID}`));
            self.tunnels[options.pid] = {
              pid: options.pid,
              ssh: sshProcess,
              inspectSocket: options.inspectSocket,
              socket: nsshServer.fqdn + ":" + options.tunnelPort,
              //nsshServerAddress: nsshServer.address,
              state: 'connected'
            };
            resolve(self.tunnels[options.pid]);
          }
        });
      }
    });
  }
  digTunnel(inspectPort, pid, retry = 0) {
    let self = this;
    // Reuse a tunnel if it exists for the same node inspect socket
    let existingTunnel = Object.values(self.tunnels).find(tunnel => tunnel.inspectSocket === `127.0.0.1:${inspectPort}`);
    if (existingTunnel && existingTunnel.pid !== pid) {
      let oldPid = existingTunnel.pid;
      existingTunnel.pid = pid;
      self.tunnels[pid] = existingTunnel;
      delete self.tunnels[oldPid];
      return Promise.resolve(self.tunnels[pid]);
    } else {
      if (self.tunnels[pid] && self.tunnels[pid].state === 'connected') return Promise.resolve(self.tunnels[pid]);
      else if (self.tunnels[pid] && self.tunnels[pid].state === 'connecting') return Promise.reject(self.tunnels[pid].state);
      else if (self.tunnels[pid] && self.tunnels[pid].state === 'retrying' && retry === 0) return Promise.reject(self.tunnels[pid].state);
      return new Promise(resolve => {
        self.tunnels[pid] = { ['state']: 'connecting' };
        self.ssh(`ss.sh`)
          .then(connection => {
            let ports = connection.stdout.match(/unused\sports:\s.*/) ? connection.stdout.match(/unused\sports:\s.*/)[0].split(':')[1].trim().toString().split(' ') : [];
            if (ports.length === 0) throw new Error('Ssh server is out of free ports.');
            let index = Math.floor(ports.length - Math.random() * ports.length);
            let tunnelPort = parseInt(ports[index]);
            return self.ssh(' -N -R *:' + tunnelPort + ':localhost:' + inspectPort, { tunnelPort, pid, inspectSocket: `127.0.0.1:${inspectPort}` });
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
  }
  generateKeyPair() {
    let keypair;
    return keypair;
  }
  getSocket(pid) {
    return this.tunnels[pid] && this.tunnels[pid].socket ? new TunnelSocket(this.tunnels[pid]) : undefined;
  }
  //privateFunction() {}
}

class TunnelSocket {
  constructor(tunnel) {
    let socket = tunnel.socket;
    return {
      socket,
      host: socket.split(':')[0],
      port: parseInt(socket.split(':')[1]),
      address: tunnel.nsshServerAddress
    }
  }
}

//function publicFunction() {}

module.exports = SSH;
