[![BrakeCODE](https://june07.github.io/image/titleLogoBlack.png)](https://brakecode.com)

Brakecode is software that runs on your hosts.  It manages telemetry data including reports and makes them available for analysis.  The Brakecode NPM package is open-source.

# Current Features
  - Node.js Diagnostic Reports
    > Delivers a JSON-formatted diagnostic summary, written to ~~a file~~ **anywhere**.

## Installation
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

### Environment Vars

  - `BRAKECODE_API_KEY` - An API Key is required to send reports to Brakecode.
  - `BRAKECODE_SERVER` - Change which server reports are sent to.
  - `BRAKECODE_SOURCE_HOST` - The source host of the reports can be changed using this var.

### Todos

 - 
