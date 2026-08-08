import { courierRegistry } from './courier.registry';
import { DelhiveryAdapter } from './delhivery/delhivery.adapter';
import { MockCourierAdapter } from './mock/mock.adapter';
import { UrbaneBoltAdapter } from './urbanebolt/urbanebolt.adapter';

const urbaneboltAdapter = new UrbaneBoltAdapter();

export function registerCouriers(): void {
  courierRegistry.register(new MockCourierAdapter());
  courierRegistry.register(urbaneboltAdapter);
  courierRegistry.register(new DelhiveryAdapter());
}

export function getUrbaneBoltCircuitStatus() {
  return urbaneboltAdapter.getCircuitStatus();
}
