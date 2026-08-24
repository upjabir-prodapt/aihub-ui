import { createServer } from 'vite';
import assert from 'node:assert';

async function testMockApi() {
  console.log('Starting Vite server in mock mode...');
  const server = await createServer({
    mode: 'mock',
    server: { port: 5199, host: '127.0.0.1' },
  });
  await server.listen();
  const baseUrl = 'http://127.0.0.1:5199';

  try {
    // 1. Test whoami
    const whoamiRes = await fetch(`${baseUrl}/api/translation/v1/auth/whoami`);
    assert.strictEqual(whoamiRes.status, 200);
    const whoamiData = await whoamiRes.json();
    assert.strictEqual(whoamiData.email, 'dev@colt.net');
    console.log('OK /auth/whoami');

    // 2. Test metadata id-token
    const tokenRes = await fetch(`${baseUrl}/api/metadata/id-token`);
    assert.strictEqual(tokenRes.status, 200);
    const tokenText = await tokenRes.text();
    assert.ok(tokenText.includes('mock_google_id_token'));
    console.log('OK /api/metadata/id-token');

    // 3. Test list translation jobs
    const jobsRes = await fetch(`${baseUrl}/api/translation/v1/jobs`);
    assert.strictEqual(jobsRes.status, 200);
    const jobsData = await jobsRes.json();
    assert.ok(Array.isArray(jobsData.jobs));
    assert.ok(jobsData.jobs.length >= 4);
    console.log(`OK GET /jobs (${jobsData.jobs.length} jobs found)`);

    // 4. Test translation job detail
    const sampleJob = jobsData.jobs[0];
    const detailRes = await fetch(`${baseUrl}/api/translation/v1/translate/${sampleJob.job_id}`);
    assert.strictEqual(detailRes.status, 200);
    const detailData = await detailRes.json();
    assert.strictEqual(detailData.job_id, sampleJob.job_id);
    assert.ok(detailData.result?.labels?.cost_usd !== undefined);
    console.log('OK GET /translate/:id detail');

    // 5. Test create translation job
    const formData = new FormData();
    const mockFile = new Blob(['Colt test document text'], { type: 'text/plain' });
    formData.append('file', mockFile, 'test-spec.txt');
    formData.append('source_language', 'en');
    formData.append('target_languages[]', 'de');
    formData.append('domain', 'commercial');

    const submitRes = await fetch(`${baseUrl}/api/translation/v1/translate`, {
      method: 'POST',
      body: formData,
    });
    assert.strictEqual(submitRes.status, 202);
    const submitData = await submitRes.json();
    assert.ok(submitData.batch_id);
    console.log(`OK POST /translate (${submitData.batch_id})`);

    // 6. Test list sales research jobs
    const salesJobsRes = await fetch(`${baseUrl}/api/sales/v1/research/jobs`);
    assert.strictEqual(salesJobsRes.status, 200);
    const salesJobsData = await salesJobsRes.json();
    assert.ok(Array.isArray(salesJobsData.jobs));
    console.log(`OK GET /api/sales/v1/research/jobs (${salesJobsData.jobs.length} jobs found)`);

    // 7. Test initiate sales research
    const initRes = await fetch(`${baseUrl}/api/sales/v1/research/initiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_name: 'Microsoft UK', account_id: 'ACC-MSFT-9901' }),
    });
    assert.strictEqual(initRes.status, 200);
    const initData = await initRes.json();
    assert.ok(initData.job_id);
    console.log(`OK POST /research/initiate (${initData.job_id})`);

    // 8. Test review submission
    const reviewRes = await fetch(`${baseUrl}/api/translation/v1/reviews/${sampleJob.job_id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 5, comment: 'Translation accuracy was excellent.' }),
    });
    assert.strictEqual(reviewRes.status, 201);
    console.log('OK POST /reviews/:id');

    console.log('\nALL MOCK API CHECKS PASSED!\n');
    await server.close();
    process.exit(0);
  } catch (err) {
    await server.close();
    throw err;
  }
}

testMockApi().catch((err) => {
  console.error('Mock verification failed:', err);
  process.exit(1);
});

