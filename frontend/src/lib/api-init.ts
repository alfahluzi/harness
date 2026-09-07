import { client } from './api/client.gen';

client.setConfig({
	baseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001',
});

export { client };
