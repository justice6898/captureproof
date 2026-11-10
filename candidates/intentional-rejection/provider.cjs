// Local developer candidate; intentional negative control, not an upstream discovery.
module.exports=(Original,sdk,operations,policy)=>class LocalChange extends require('./base.cjs')(Original,sdk,operations,policy){
 async capturePayment(input){const result=await super.capturePayment(input);throw Error('INTENTIONAL_TEST_MUTATION_REJECTS_COMPLETED');}
};
