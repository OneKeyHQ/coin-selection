import * as CardanoWasm from '@emurgo/cardano-serialization-lib-asmjs';

export const createKeyWitnessSet = (
  tagCborSets: boolean,
  vkeys: CardanoWasm.Vkeywitnesses,
  bootstraps?: CardanoWasm.BootstrapWitnesses,
): CardanoWasm.TransactionWitnessSet => {
  // FixedTxWitnessesSet preserves the tag style of parsed collections.
  // Seed only collections that will contain signatures to avoid empty fields.
  const emptySet = tagCborSets ? 'd9010280' : '80';
  const fields: string[] = [];
  if (vkeys.len() > 0) fields.push(`00${emptySet}`);
  if (bootstraps && bootstraps.len() > 0) fields.push(`02${emptySet}`);
  const fixed = CardanoWasm.FixedTxWitnessesSet.from_bytes(
    Buffer.from(
      `${(0xa0 + fields.length).toString(16)}${fields.join('')}`,
      'hex',
    ),
  );

  for (let i = 0; i < vkeys.len(); i++) {
    fixed.add_vkey_witness(vkeys.get(i));
  }
  if (bootstraps) {
    for (let i = 0; i < bootstraps.len(); i++) {
      fixed.add_bootstrap_witness(bootstraps.get(i));
    }
  }
  const witnesses = fixed.tx_witnesses_set();
  fixed.free();
  return witnesses;
};
