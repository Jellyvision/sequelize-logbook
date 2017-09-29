const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.should();
chai.use(chaiAsPromised);

global.expect = chai.expect;
global.assert = chai.assert;

process.on('unhandledRejection', function(event, promise) {
  console.log('Unhandled promise rejection:');
  console.log(promise);
  console.trace(event.stack);
});
