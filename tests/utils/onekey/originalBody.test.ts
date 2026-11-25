import { randomBytes } from 'node:crypto';
import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { dAppUtils } from '../../../src/utils/onekey/dapp';
import { hasSetTagWithBody } from '../../../src/utils/onekey/hasSetTag';
import { signTransaction } from '../../../src/utils/onekey/signTx';
import { txToOneKey } from '../../../src/utils/onekey/txToOneKey';
import type { IChangeAddress } from '../../../src/utils/onekey/types';
import { signTransaction as hardwareSign } from '../../../src/utils/trezor/sign';

// Message signing is unused here; transaction signatures use real CSL bindings.
jest.mock(
  '@emurgo/cardano-message-signing-asmjs/cardano_message_signing',
  () => ({}),
);

function fixture(tagged: boolean, map: boolean) {
  const root = Cardano.Bip32PrivateKey.from_bip39_entropy(
    randomBytes(32),
    new Uint8Array(),
  );
  const account = root.derive(0x8000073c).derive(0x80000717).derive(0x80000000);
  const payment = account.derive(0).derive(0).to_raw_key();
  const stake = account.derive(2).derive(0).to_raw_key();
  const address = Cardano.BaseAddress.new(
    1,
    Cardano.Credential.from_keyhash(payment.to_public().hash()),
    Cardano.Credential.from_keyhash(stake.to_public().hash()),
  )
    .to_address()
    .to_bech32();
  const input = `825820${'22'.repeat(32)}00`;
  const recipient = `581d61${'44'.repeat(28)}`;
  const output = map
    ? `a200${recipient}011a001e8480`
    : `82${recipient}1a001e8480`;
  const body = `a300${tagged ? 'd90102' : ''}81${input}0181${output}021a0002bf20`;
  const txHex = `84${body}a0f5f6`;
  const fixed = Cardano.FixedTransaction.from_hex(txHex);
  const changeAddress: IChangeAddress = {
    address,
    addressParameters: {
      addressType: 0,
      path: "m/1852'/1815'/0'/0/0",
      stakingPath: "m/1852'/1815'/0'/2/0",
    },
  };
  const keys = {
    payment: { hash: null, path: changeAddress.addressParameters.path },
    stake: { hash: null, path: changeAddress.addressParameters.stakingPath },
  };
  const utxos = [
    {
      path: changeAddress.addressParameters.path,
      address,
      tx_hash: '22'.repeat(32),
      tx_index: 0,
      output_index: 0,
      amount: [{ unit: 'lovelace', quantity: '2180000' }],
    },
  ];
  return {
    root,
    account,
    payment,
    address,
    body,
    txHex,
    fixed,
    changeAddress,
    keys,
    utxos,
  };
}

describe('original transaction body', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    { tagged: false, map: false },
    { tagged: false, map: true },
    { tagged: true, map: false },
    { tagged: true, map: true },
  ])(
    'preserves taggedInputs=$tagged and mapOutputs=$map',
    async ({ tagged, map }) => {
      const data = fixture(tagged, map);
      const hash = data.fixed.transaction_hash();
      for (const txHex of [data.txHex, data.body]) {
        const encoded = await dAppUtils.convertCborTxToEncodeTx({
          txHex,
          utxos: data.utxos,
          addresses: [data.address],
          changeAddress: data.changeAddress,
          isSignOnly: true,
        });
        expect(encoded.tx.body).toBe(data.body);
        expect(encoded.tx.hash).toBe(hash.to_hex());
        if (!encoded.tx.rawTxHex) throw new Error('Missing raw transaction');
        expect(
          Cardano.FixedTransaction.from_hex(encoded.tx.rawTxHex).raw_body(),
        ).toEqual(data.fixed.raw_body());
      }
      expect(await hasSetTagWithBody(data.body)).toBe(tagged);
      const params = await txToOneKey(
        data.txHex,
        1,
        data.keys,
        data.account.to_public().to_hex(),
        data.changeAddress,
      );
      expect(params.tagCborSets).toBe(tagged);
      expect(params.outputs).toMatchObject([{ format: map ? 1 : 0 }]);

      const signed = await signTransaction(
        data.body,
        data.address,
        0,
        data.utxos,
        data.root.to_bech32(),
        true,
        false,
      );
      const vkeys = Cardano.TransactionWitnessSet.from_hex(
        signed.signedTx,
      ).vkeys();
      if (!vkeys) throw new Error('Missing vkey witnesses');
      expect(vkeys.len()).toBe(1);
      const witness = vkeys.get(0);
      expect(
        witness
          .vkey()
          .public_key()
          .verify(hash.to_bytes(), witness.signature()),
      ).toBe(true);
      const canonicalHash = Cardano.FixedTransactionBody.from_bytes(
        data.fixed.body().to_bytes(),
      ).tx_hash();
      if (canonicalHash.to_hex() !== hash.to_hex()) {
        expect(
          witness
            .vkey()
            .public_key()
            .verify(canonicalHash.to_bytes(), witness.signature()),
        ).toBe(false);
      }
      const full = await signTransaction(
        data.body,
        data.address,
        0,
        data.utxos,
        data.root.to_bech32(),
        false,
        false,
      );
      expect(
        Buffer.from(
          Cardano.FixedTransaction.from_hex(full.signedTx).raw_body(),
        ).toString('hex'),
      ).toBe(data.body);
      expect(full.txid).toBe(hash.to_hex());

      const hardwareTx = await hardwareSign(data.body, [
        {
          type: 1,
          pubKey: witness.vkey().public_key().to_hex(),
          signature: witness.signature().to_hex(),
        },
      ]);
      expect(
        Buffer.from(
          Cardano.FixedTransaction.from_hex(hardwareTx).raw_body(),
        ).toString('hex'),
      ).toBe(data.body);
    },
  );

  test('reads set tags from the body instead of existing witnesses', async () => {
    const data = fixture(false, true);
    const witnesses = Cardano.TransactionWitnessSet.new();
    const vkeys = Cardano.Vkeywitnesses.new();
    vkeys.add(
      Cardano.make_vkey_witness(data.fixed.transaction_hash(), data.payment),
    );
    witnesses.set_vkeys(vkeys);
    const tx = Cardano.FixedTransaction.new(
      data.fixed.raw_body(),
      witnesses.to_bytes(),
      true,
    );
    expect(Cardano.has_transaction_set_tag(tx.to_bytes())).toBe(
      Cardano.TransactionSetsState.MixedSets,
    );
    const params = await txToOneKey(
      tx.to_hex(),
      1,
      data.keys,
      data.account.to_public().to_hex(),
      data.changeAddress,
    );
    expect(params.tagCborSets).toBe(false);
  });
});
