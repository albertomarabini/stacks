import { Store } from '../models/core';

class StoreListUiDelegate {
  renderStoreList(
    container: HTMLElement,
    data: Store[],
    handlers: {
      onActivateToggle: (storeId: string, newState: boolean) => void,
      onRotateKeys: (storeId: string) => void,
      onEditBranding: (storeId: string) => void,
      onSetSbtc: (storeId: string) => void,
    }
  ): void {
    container.innerHTML = '';
    for (const store of data) {
      const row = document.createElement('div');
      row.className = 'flex flex-row items-center border-b py-2';
      const display = store.displayName || store.name;
      row.innerHTML = `
        <div class="w-44 font-semibold">${display}</div>
        <div class="w-48 truncate">${store.principal}</div>
        <div class="w-36">${store.active ? '<span class="text-green-600">Active</span>' : '<span class="text-gray-400">Inactive</span>'}</div>
        <div class="w-36">${store.sBTCContractAddress ? 'sBTC Configured' : '<span class="text-red-500">No sBTC</span>'}</div>
        <div class="w-20">
          <button class="toggle-activate px-2 py-1 rounded ${store.active ? 'bg-gray-200' : 'bg-green-200'}" data-storeid="${store.storeId}" data-newstate="${store.active ? 'false' : 'true'}">${store.active ? 'Deactivate' : 'Activate'}</button>
        </div>
        <div class="w-20">
          <button class="rotate-keys px-2 py-1 bg-blue-400 rounded text-white" data-storeid="${store.storeId}">Rotate Keys</button>
        </div>
        <div class="w-20">
          <button class="edit-branding px-2 py-1 bg-yellow-300 rounded" data-storeid="${store.storeId}">Edit Branding</button>
        </div>
        <div class="w-20">
          <button class="set-sbtc px-2 py-1 bg-purple-400 rounded text-white" data-storeid="${store.storeId}">Set sBTC</button>
        </div>
      `;
      container.appendChild(row);
    }
    container.querySelectorAll('.toggle-activate').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tgt = e.currentTarget as HTMLButtonElement;
        handlers.onActivateToggle(tgt.getAttribute('data-storeid')!, tgt.getAttribute('data-newstate') === 'true');
      });
    });
    container.querySelectorAll('.rotate-keys').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tgt = e.currentTarget as HTMLButtonElement;
        handlers.onRotateKeys(tgt.getAttribute('data-storeid')!);
      });
    });
    container.querySelectorAll('.edit-branding').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tgt = e.currentTarget as HTMLButtonElement;
        handlers.onEditBranding(tgt.getAttribute('data-storeid')!);
      });
    });
    container.querySelectorAll('.set-sbtc').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tgt = e.currentTarget as HTMLButtonElement;
        handlers.onSetSbtc(tgt.getAttribute('data-storeid')!);
      });
    });
  }
}

export { StoreListUiDelegate };
