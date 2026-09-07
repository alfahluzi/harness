import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
	input: '../backend/openapi.json',
	output: {
		path: 'src/lib/api',
	},
	plugins: [
		'@hey-api/typescript',
		'@hey-api/sdk',
		'@hey-api/client-fetch',
		'@tanstack/react-query',
	],
});
