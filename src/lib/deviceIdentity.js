// QualysBridge — device identity bootstrap
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const APP_INSTANCE_KEY = 'qualysbridge_app_instance_id';

export async function getAppInstanceId() {
  let instanceId = await SecureStore.getItemAsync(APP_INSTANCE_KEY);

  if (!instanceId) {
    instanceId = Crypto.randomUUID();
    await SecureStore.setItemAsync(APP_INSTANCE_KEY, instanceId);
  }

  return instanceId;
}
