// Vercel serverless function (Node.js runtime).
// Receives the user's task list + daily capacity, asks a Groq-hosted model to triage it,
// and returns strict JSON the frontend can render directly.

const SYSTEM_PROMPT = `You are "Deadline Doctor," an admissions-triage assistant for an overloaded student or worker.

You will receive JSON describing:
- today's date
- how many hours per day the person can realistically work
- a list of tasks, each with a title, a deadline, estimated hours needed, and a stakes level (low/medium/high)

Your job:
1. Work out, day by day between today and the furthest deadline, which task(s) the person should work on and for roughly how long. Prioritize by urgency (days remaining) AND stakes (high-stakes tasks should not be crammed last-minute even if not the soonest deadline). Be specific and directive — say what to do, not just what exists.
2. Decide a verdict: "ok" if the total estimated hours fit inside the available daily hours before each deadline, "overloaded" if they clearly do not.
3. If overloaded, say plainly in "cuts" which task(s) are the best candidates to cut, delay, ask for an extension on, or do a reduced/minimum version of — and briefly why those and not others. Prefer cutting low-stakes work over high-stakes work. Never suggest cutting something without saying what a "minimum version" would look like if one is possible.
4. Be honest and direct, like a doctor giving a real diagnosis — not falsely reassuring. If the plan is tight but possible, say so plainly. If it is not possible, say so plainly and explain why (e.g. "you have 14 hours of work and 6 available hours before Tuesday").
5. Keep total output concise: a one-sentence summary, 3-7 day entries (group days if the plan is long — e.g. "Mon-Tue" is a valid label), and cuts only if verdict is "overloaded".

Respond with ONLY valid JSON, no markdown fences, no commentary outside the JSON, matching exactly this shape:
{
  "verdict": "ok" | "overloaded",
  "summary": "one sentence, plain language",
  "days": [ { "label": "Mon 28 Jul", "plan": "what to do this day, specific and short" } ],
  "cuts": ["short actionable suggestion", ...]  // omit or empty array if verdict is "ok"
}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST' });
    return;
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server is missing GROQ_API_KEY. Set it in your hosting environment variables.' });
    return;
  }

  const { today, dailyHours, tasks } = req.body || {};

  if (!Array.isArray(tasks) || tasks.length === 0) {
    res.status(400).json({ error: 'No tasks provided.' });
    return;
  }

  const userPayload = JSON.stringify({ today, dailyHours, tasks });

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1200,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPayload }
        ]
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      res.status(502).json({ error: `Groq API error: ${errBody.slice(0, 300)}` });
      return;
    }

    const data = await response.json();
    const rawText = (data.choices?.[0]?.message?.content || '').trim();

    let parsed;
    try {
      const cleaned = rawText.replace(/^```json\s*|```$/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      res.status(502).json({ error: 'Could not parse the AI response. Please try again.' });
      return;
    }

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown server error.' });
  }
}