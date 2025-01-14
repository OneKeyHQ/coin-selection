import { Utxo } from '../../src/types/types';

export const prepareUtxo = (utxo: Utxo, update: Partial<Utxo>): Utxo => {
  return {
    ...utxo,
    ...update,
  };
};

export const changeAddress =
  'addr1q8u2f05rprqjhygz22m06mhy4xrnqvqqpyuzhmxqfxnwvxz8d2kd47hsre5v9urjyu8s0ryk38dxzw0t5jesncw4v90s22tk0f';

export const utxo1 = Object.freeze({
  address:
    'addr1q860vxljhadqxnrrsr2j6yxnwpdkyquq74lmghx502aj0r28d2kd47hsre5v9urjyu8s0ryk38dxzw0t5jesncw4v90sp0878u',
  txHash: '3c388acb799a37a4f1cc99bec7626637b0b80626b9ef7c7a687282cab701178d',
  outputIndex: 0,
  amount: [
    {
      quantity: '5000000',
      unit: 'lovelace',
    },
  ],
});

export const utxo2 = Object.freeze({
  address:
    'addr1q860vxljhadqxnrrsr2j6yxnwpdkyquq74lmghx502aj0r28d2kd47hsre5v9urjyu8s0ryk38dxzw0t5jesncw4v90sp0878u',
  txHash: '9e63fddf20cb7b5472e2c9a1bb4bbe3112b8f2b22e45bc441206bcddde5c58a0',
  outputIndex: 1,
  amount: [
    {
      quantity: '5000000',
      unit: 'lovelace',
    },
    {
      quantity: '1000',
      unit: '02477d7c23b4c2834b0be8ca8578dde47af0cc82a964688f6fc95a7a47524943',
    },
  ],
});

export const utxo3 = Object.freeze({
  ...prepareUtxo(utxo1, {
    outputIndex: 2,
    amount: [
      {
        quantity: '10000000',
        unit: 'lovelace',
      },
    ],
  }),
});

export const utxo4 = Object.freeze({
  ...prepareUtxo(utxo1, {
    outputIndex: 3,
    amount: [
      {
        quantity: '2000000',
        unit: 'lovelace',
      },
    ],
  }),
});
export const utxo5 = Object.freeze({
  ...prepareUtxo(utxo1, {
    outputIndex: 4,
    amount: [
      {
        quantity: '1000000',
        unit: 'lovelace',
      },
    ],
  }),
});

export const utxo6 = Object.freeze({
  ...prepareUtxo(utxo2, {
    outputIndex: 7,
    amount: [
      {
        quantity: '4000000',
        unit: 'lovelace',
      },
      {
        quantity: '2000',
        unit: '02477d7c23b4c2834b0be8ca8578dde47af0cc82a964688f6fc95a7a47524943',
      },
      {
        quantity: '100',
        unit: 'c6207cbbc916fa3bbb4b91cc7789c7d7ddfb84264fa76f7ee627a9d8',
      },
    ],
  }),
});

export const utxo7 = Object.freeze({
  ...prepareUtxo(utxo2, {
    outputIndex: 8,
    amount: [
      {
        quantity: '1410000',
        unit: 'lovelace',
      },
      {
        quantity: '1000',
        unit: '02477d7c23b4c2834b0be8ca8578dde47af0cc82a964688f6fc95a7a47524943',
      },
    ],
  }),
});

export const utxo8 = Object.freeze({
  ...prepareUtxo(utxo2, {
    outputIndex: 7,
    amount: [
      {
        quantity: '2000000',
        unit: 'lovelace',
      },
      {
        quantity: '2000',
        unit: '02477d7c23b4c2834b0be8ca8578dde47af0cc82a964688f6fc95a7a47524943',
      },
      {
        quantity: '100',
        unit: 'c6207cbbc916fa3bbb4b91cc7789c7d7ddfb84264fa76f7ee627a9d8',
      },
    ],
  }),
});
