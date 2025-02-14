import { composeTxPlan } from './transaction';
import { signTransaction, signTx } from './signTx';
import { dAppUtils } from './dapp';
import { txToOneKey } from './txToOneKey';
import { hasSetTagWithBody } from './hasSetTag';

const onekeyUtils = {
  composeTxPlan,
  signTransaction,
  signTx,
  txToOneKey,
  hasSetTagWithBody,
};

export { onekeyUtils, dAppUtils };
