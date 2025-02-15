import type { DurableObjectState, DurableObjectStorage, ExportedHandlerFetchHandler } from "@cloudflare/workers-types";

interface Document {
	id: string;
	title: string;
	type: string;
	status: 'Pending' | 'Processed' | 'Needs Review';
	createdAt: string;
	urls: string[];
	analysisResult?: any;
	selections?: Selection[];
}

interface Selection {
	id: number;
	color: string;
	points: number[];
	text: string;
	type: string;
}

/** A Durable Object's behavior is defined in an exported Javascript class */
export class MyDurableObject implements DurableObject {
	private storage: DurableObjectStorage;

	/**
	 * The constructor is invoked once upon creation of the Durable Object, i.e. the first call to
	 * 	`DurableObjectStub::get` for a given identifier (no-op constructors can be omitted)
	 *
	 * @param ctx - The interface for interacting with Durable Object state
	 * @param env - The interface to reference bindings declared in wrangler.jsonc
	 */
	constructor(ctx: DurableObjectState, env: Env) {
		this.storage = ctx.storage;
	}

	/**
	 * The Durable Object exposes an RPC method sayHello which will be invoked when when a Durable
	 *  Object instance receives a request from a Worker via the same method invocation on the stub
	 *
	 * @param name - The name provided to a Durable Object instance from a Worker
	 * @returns The greeting to be sent back to the Worker
	 */
	async sayHello(name: string): Promise<string> {
		return `Hello, ${name}!`;
	}

	async fetch(request: Request): Promise<Response> {
		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
		};

		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		const url = new URL(request.url);
		const path = url.pathname;

		try {
			// Document List Endpoint
			if (path === '/api/documents' && request.method === 'GET') {
				const documents = await this.storage.get('all_documents');
				return new Response(JSON.stringify(documents || []), {
					headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				});
			}

			// Create Document Endpoint
			if (path === '/api/documents' && request.method === 'POST') {
				const { title, type, urls } = await request.json() as {
					title: string;
					type: string;
					urls: string[];
				};
				
				const documentId = `doc_${Date.now()}`;
				const newDocument: Document = {
					id: documentId,
					title,
					type,
					status: 'Pending',
					createdAt: new Date().toISOString(),
					urls,
				};

				// Update documents list
				const existingDocs = (await this.storage.get('all_documents') || []) as Document[];
				existingDocs.unshift(newDocument);
				await this.storage.put('all_documents', existingDocs);
				
				// Store individual document
				await this.storage.put(documentId, newDocument);

				return new Response(JSON.stringify(newDocument), {
					status: 201,
					headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				});
			}

			// Single Document Endpoint
			if (path.match(/^\/api\/documents\/[\w-]+$/) && request.method === 'GET') {
				const documentId = path.split('/').pop()!;
				const document = await this.storage.get(documentId);
				
				if (!document) {
					return new Response(JSON.stringify({ error: 'Document not found' }), {
						status: 404,
						headers: { ...corsHeaders, 'Content-Type': 'application/json' },
					});
				}

				return new Response(JSON.stringify(document), {
					headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				});
			}

			// Update Document Selections Endpoint
			if (path.match(/^\/api\/documents\/[\w-]+\/selections$/) && request.method === 'PUT') {
				const documentId = path.split('/')[3];
				const { selections } = await request.json() as { selections: Selection[] };
				
				const document = await this.storage.get(documentId) as Document;
				if (document) {
					document.selections = selections;
					await this.storage.put(documentId, document);
				}

				return new Response(JSON.stringify({ success: true }), {
					headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				});
			}

			// Update Document Status Endpoint
			if (path.match(/^\/api\/documents\/[\w-]+\/status$/) && request.method === 'PUT') {
				const documentId = path.split('/')[3];
				const { status } = await request.json() as { status: 'Pending' | 'Processed' | 'Needs Review' };
				
				const document = await this.storage.get(documentId) as Document;
				if (document) {
					document.status = status;
					await this.storage.put(documentId, document);

					// Update in all_documents list
					const allDocs = (await this.storage.get('all_documents') || []) as Document[];
					const updatedDocs = allDocs.map((doc: Document) => 
						doc.id === documentId ? { ...doc, status } : doc
					);
					await this.storage.put('all_documents', updatedDocs);
				}

				return new Response(JSON.stringify({ success: true }), {
					headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				});
			}

			return new Response(JSON.stringify({ error: 'Not found' }), {
				status: 404,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});

		} catch (error) {
			return new Response(JSON.stringify({ error: 'Internal server error' }), {
				status: 500,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});
		}
	}
}

export default {
	/**
	 * This is the standard fetch handler for a Cloudflare Worker
	 *
	 * @param request - The request submitted to the Worker from the client
	 * @param env - The interface to reference bindings declared in wrangler.jsonc
	 * @param ctx - The execution context of the Worker
	 * @returns The response to be sent back to the client
	 */
	fetch: (async (request: Request, env: Env, ctx: ExecutionContext) => {
		const id = env.MY_DURABLE_OBJECT.idFromName('documents');
		const stub = env.MY_DURABLE_OBJECT.get(id);
		return stub.fetch(request);
	})
};
