[![BrakeCODE](https://june07.github.io/image/titleLogoBlack.png)](https://brakecode.com)

Brakecode is software that runs on your hosts.  It manages Node.js debugging and other [V8 Inspector Protocol](https://v8.dev/) sessions as well as diagnostic reports.  The Brakecode NPM package is open-source.

# Current Features
  - PADS Secure (certificate based SSH tunnel) Remote Debugging
    * Fully managed SSH tunnels
    * Multiple tunnels per host
    * Multiple hosts per user
    * Easily share debugging sessions with other developers.

  - Node.js Diagnostic Reports
    > Delivers a JSON-formatted diagnostic summary, written to ~~a file~~ **anywhere**.

# PADS
## Installation for PADS usage...
`npm install -g brakecode` or run with npx `npx brakecode`

![Running BrakeCODE agent](https://github.brakecode.com/image/brakecode-node-npx-run.gif)
You will then be able to access your V8 debugger sessions from your dashboard.  Further if you are logged into the NiM client, you can access remote sessions there as well.  To open remote sessions, you must be logged into the BrakeCODE dashboard, otherwise NiM will simply show session data.

![BrakeCODE PADS panel](https://github.brakecode.com/image/brakecode-dashboard-1.png)

Login to BrakeCODE dashboard from NiM

![Login to BrakeCODE dashboard from NiM](https://github.brakecode.com/image/NiM-devToolsPanel.png)

---

# Node.js Diagnostic Reports
## Installation as an application dependency for Node.js diagnostic reports usage...
Install the dependencies and devDependencies and start the server.

```sh
$ npm install brakecode
```

## Usage
Example helloworld usage just requires the inclusion of the brakecode package.  And very similar to native report handling `process.report.writeReport()`, you instead use `brakecode.sendReport()`.

```node.js
brakecode = require('./brakecode')();
let report = brakecode.sendReport();
```
Reports can then be easily accessed from Chromium DevTools as shown:

![](https://res.cloudinary.com/june07/image/upload/v1575921920/brakecode/Annotation_2019-12-09_0927536-edited.png)

### Redacted by default

Sensitive data is now redacted by default thanks to [rtk](https://github.com/IBM/report-toolkit).  To send unredacted reports set the `BRAKECODE_NOREDACT` env var to true.

![redacted](https://res.cloudinary.com/june07/image/upload/v1577398429/brakecode/Annotation_2019-12-26_140522.png)
### Environment Vars

  - `BRAKECODE_NOREDACT` - Set to true to disable redaction.
  - `BRAKECODE_API_KEY` - An API Key is required to send reports to Brakecode.
  - `BRAKECODE_SERVER` - Change which server reports are sent to.
  - `BRAKECODE_SOURCE_HOST` - The source host of the reports can be changed using this var.