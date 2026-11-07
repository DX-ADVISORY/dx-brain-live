/* DX expertise model. Counts require stage receipts and confirmed daily coverage. */
(function (root) {
  'use strict';
  const STAGES = ['ingested', 'approved', 'memory_written', 'retrieval_passed', 'applied'];
  const isoWithZone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  const validTime = value => typeof value === 'string' && isoWithZone.test(value) && Number.isFinite(Date.parse(value));
  const dayIct = value => {
    if (!validTime(value)) return null;
    return new Date(Date.parse(value) + 7 * 3600000).toISOString().slice(0, 10);
  };
  function validate(data) {
    const errors = [];
    if (data.schema !== 'dx-expertise-public/v1') errors.push('schema không phù hợp');
    if (data.active_client !== 'NONE_UNLESS_EXPLICIT') errors.push('bản công khai không được gắn khách hàng');
    if (data.timezone !== 'Asia/Ho_Chi_Minh') errors.push('múi giờ không phù hợp');
    if (!validTime(data.source_snapshot?.as_of)) errors.push('thiếu mốc ảnh nguồn');
    const groups = data.source_snapshot?.skills || [];
    if (groups.some(g => !Number.isSafeInteger(g.count) || g.count < 0)) errors.push('số kỹ năng không hợp lệ');
    if (new Set(groups.map(g => g.id)).size !== groups.length) errors.push('trùng nhóm kỹ năng');
    if (groups.reduce((n, g) => n + g.count, 0) !== data.source_snapshot?.skills_total) errors.push('tổng kỹ năng không khớp');
    ['industries', 'needs'].forEach(key => {
      if (!Array.isArray(data[key]) || !data[key].length) errors.push('thiếu ' + key);
      else if (new Set(data[key].map(x => x.id)).size !== data[key].length) errors.push('trùng ' + key);
    });
    if (!Array.isArray(data.events) || !Array.isArray(data.daily_coverage)) errors.push('thiếu nhật ký hoặc độ phủ');
    (data.events || []).forEach(e => {
      if (!STAGES.includes(e.stage) || !validTime(e.occurred_at) || !e.event_id || !e.resource_key || !e.version || !e.receipt_id || !['source','legal_document','skill','knowledge_card','lesson','work_product'].includes(e.resource_type)) errors.push('sự kiện thiếu khóa, mốc, loại hoặc biên nhận');
      if (!data.industries.some(x => x.id === e.industry_id) || !data.needs.some(x => x.id === e.need_id)) errors.push('sự kiện có nhãn chưa khai báo');
      if (e.source_checked_at && !validTime(e.source_checked_at)) errors.push('mốc kiểm nguồn không hợp lệ');
    });
    (data.daily_coverage || []).forEach(c => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date) || !validTime(c.generated_at) || !c.receipt_id || !Array.isArray(c.stages) || c.stages.some(s => !STAGES.includes(s))) errors.push('biên nhận độ phủ không hợp lệ');
      if (!data.industries.some(x => x.id === c.industry_id) || !data.needs.some(x => x.id === c.need_id)) errors.push('độ phủ có nhãn chưa khai báo');
    });
    return [...new Set(errors)];
  }
  function eligible(e, data) {
    if (e.public_approved !== true || e.privacy_reviewed !== true || !e.receipt_id) return false;
    if (!STAGES.includes(e.stage) || !validTime(e.occurred_at)) return false;
    if (e.stage !== 'ingested' && (!e.source_url || !validTime(e.source_checked_at) || !e.review_receipt_id)) return false;
    if (e.stage === 'memory_written' && !e.write_receipt_id) return false;
    if (e.stage === 'retrieval_passed' && (!e.test_receipt_id || e.test_result !== 'PASS')) return false;
    if (e.stage === 'applied' && !e.application_receipt_id) return false;
    if ((e.need_id === 'legal' || e.resource_type === 'legal_document' || e.contains_legal_claims === true) && e.stage !== 'ingested') {
      // Existence in the PDF folder does not prove applicability.
      if (!e.legal_review_receipt_id || e.authoritative_source !== true || !validTime(e.legal_verified_at)) return false;
      if (e.legal_status !== 'effective' || !/^\d{4}-\d{2}-\d{2}$/.test(e.effective_from || '')) return false;
      const day = dayIct(e.occurred_at);
      if (e.effective_from > day || (e.effective_to && e.effective_to <= day)) return false;
      if (e.transition_checked !== true || !e.applicability_scope) return false;
    }
    return data.industries.some(x => x.id === e.industry_id) && data.needs.some(x => x.id === e.need_id);
  }
  function daily(data, industryId, needId, date) {
    const coverage = (data.daily_coverage || []).filter(c => c.industry_id === industryId && c.need_id === needId && c.date === date && c.complete === true && c.public_approved === true && c.privacy_reviewed === true && c.receipt_id && validTime(c.generated_at));
    const events = (data.events || []).filter(e => e.industry_id === industryId && e.need_id === needId && dayIct(e.occurred_at) === date && eligible(e, data));
    const counts = Object.fromEntries(STAGES.map(stage => {
      const covered = coverage.some(c => c.stages.includes(stage));
      const keys = new Set(events.filter(e => e.stage === stage).map(e => e.resource_key + '\u0000' + e.version));
      return [stage, covered ? keys.size : null];
    }));
    return { date, counts, coverage, events };
  }
  function plan(data, industryId, needId) {
    const industry = data.industries.find(x => x.id === industryId);
    const need = data.needs.find(x => x.id === needId);
    if (!industry || !need) throw new Error('Ngành hoặc nhu cầu chưa được khai báo');
    return { industry, need, topics: industry[need.topic_key], outputs: need.outputs, skills: data.source_snapshot.skills.filter(x => need.skill_ids.includes(x.id)) };
  }
  const api = { STAGES, dayIct, validate, eligible, daily, plan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DXExpertiseModel = api;
})(typeof window === 'undefined' ? {} : window);
