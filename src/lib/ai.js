import axios from 'axios';

export async function aiDraft({ sectionName, tone, styleId, context }){
  const { data } = await axios.post('/api/ai/draft', { sectionName, tone, styleId, context });
  return data.text || '';
}

export async function aiKeywords({ title, discipline, abstract = '', seedKeywords = [] }){
  const { data } = await axios.post('/api/ai/keywords', { title, discipline, abstract, seedKeywords });
  return data.suggestions || [];
}

export async function aiHumanize(text, degree='light'){
  const { data } = await axios.post('/api/ai/humanize', { text, degree });
  return data.text || text;
}
