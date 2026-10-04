import { useCallback, useEffect, useState } from "react"
import { useTeamClient } from "./team-client-context"
import { errorMessage, type SharedProfileBody, type DiscoveryPreferences, type ProfileMatches, type ExistingTeamMatches } from "@/lib/teams-api"
import { useI18n } from "@/lib/i18n/context"
import { coachDraft } from "@/lib/collaboration-auth"

const empty: SharedProfileBody = { skills: [], roles: [], interests: [], goals: [], languages: [], timezone: "", meeting_slots: [], hours_per_week: null, looking: false }
const defaults: DiscoveryPreferences = { desired_skills: [], required_skills: [], required_languages: [], min_hours: null, required_meeting_slots: [], team_size: 3 }
const split = (value: string) => value.split(",").map(item => item.trim()).filter(Boolean)
const dayKeys = ["teams.profiles.days.0", "teams.profiles.days.1", "teams.profiles.days.2", "teams.profiles.days.3", "teams.profiles.days.4", "teams.profiles.days.5", "teams.profiles.days.6"] as const
const tagKeys = ["skills", "roles", "interests", "goals", "languages"] as const
type MemberSummary = { account_id: string; display_name: string; profile: SharedProfileBody }

export function ProfilePanel({ classId = "", assignments = [], teamId, classProject = false }: {
  classId?: string; assignments?: Array<{ id: string; title: string }>; teamId?: string; classProject?: boolean
}) {
  const api = useTeamClient()
  const { t } = useI18n()
  const [profile, setProfile] = useState<SharedProfileBody>(empty)
  const [version, setVersion] = useState(0)
  const [published, setPublished] = useState(false)
  const [discovery, setDiscovery] = useState(false)
  const [review, setReview] = useState(false)
  const [checked, setChecked] = useState(false)
  const [preferences, setPreferences] = useState<DiscoveryPreferences>(defaults)
  const [assignment, setAssignment] = useState("")
  const [requireMeeting, setRequireMeeting] = useState(false)
  const [matches, setMatches] = useState<ProfileMatches | null>(null)
  const [teamMatches, setTeamMatches] = useState<ExistingTeamMatches | null>(null)
  const [candidate, setCandidate] = useState<MemberSummary | null>(null)
  const [teammates, setTeammates] = useState<MemberSummary[]>([])
  const [requested, setRequested] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [day, setDay] = useState(0)
  const [draftNote, setDraftNote] = useState<string | null>(null)
  const [hour, setHour] = useState(9)
  const clearMatches = () => { setMatches(null); setTeamMatches(null); setCandidate(null) }
  const initialize = useCallback(async () => {
    const [value, prefs] = await Promise.all([
      teamId ? api.ownTeamProfile(teamId) : api.ownProfile(classId),
      teamId ? Promise.resolve(defaults) : api.preferences(classId),
    ])
    setProfile(value.profile); setVersion(value.version); setPublished(value.published)
    setDiscovery("discovery" in value && Boolean(value.discovery))
    setPreferences(prefs); setRequireMeeting(prefs.required_meeting_slots.length > 0)
    setReview(false); setChecked(false); setMatches(null); setTeamMatches(null); setCandidate(null)
    setTeammates([]); setLoaded(true)
  }, [api, classId, teamId])
  useEffect(() => { setLoaded(false); void initialize().catch(reason => setError(errorMessage(reason))) }, [initialize])
  useEffect(() => {
    if (!matches && !teamMatches && !candidate && !teammates.length) return
    const timer = window.setTimeout(() => { setMatches(null); setTeamMatches(null); setCandidate(null); setTeammates([]) }, 60_000)
    return () => window.clearTimeout(timer)
  }, [matches, teamMatches, candidate, teammates])
  const act = async (action: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await action() } catch (reason) { setError(errorMessage(reason)); clearMatches(); setTeammates([]) }
    finally { setBusy(false) }
  }
  const slotName = (slot: number) => `${t(dayKeys[Math.floor(slot / 24)])} ${String(slot % 24).padStart(2, "0")}:00 UTC`
  const savePreferences = async () => {
    if (requireMeeting && !profile.meeting_slots.length) throw new Error(t("teams.profiles.selectTimes"))
    const clean = { ...preferences, desired_skills: split(preferences.desired_skills.join(",")), required_skills: split(preferences.required_skills.join(",")), required_languages: split(preferences.required_languages.join(",")), required_meeting_slots: requireMeeting ? profile.meeting_slots : [] }
    await api.savePreferences(classId, clean)
    clearMatches()
  }
  const factors = (team: ProfileMatches["teams"][number] | ExistingTeamMatches["teams"][number]) => <>
    <p>{t("teams.profiles.coverage")}: <bdi>{team.factors.desired_skills_covered.join(", ") || "—"}</bdi></p>
    <p>{t("teams.profiles.complement")}: <bdi>{team.factors.complementary_skills.join(", ") || "—"}</bdi></p>
    <p>{team.factors.common_meeting_slots.map(slotName).join(", ") || t("teams.profiles.unknownSchedule")}</p>
    {team.missing.schedule_count || team.missing.commitment_count ? <p>{t("teams.profiles.missing", { schedules: team.missing.schedule_count, hours: team.missing.commitment_count })}</p> : null}
  </>
  if (!loaded) return <section><p>{error ?? t("teams.workspace.opening")}</p><button className="tm-btn" disabled={busy} onClick={() => void act(initialize)}>{t("teams.common.tryAgain")}</button></section>
  return <div className="gp-profile">
    <section className="gp-pcard">
    <div className="gp-pcard-head"><h3 className="gp-h2">{t(teamId ? "teams.profiles.teamHeading" : "teams.gp.profileTitle")}</h3>
      <span className="gp-pill" data-on={published ? "" : undefined}>{t(published ? "teams.gp.profileStatusOn" : "teams.gp.profileStatusOff")}</span></div>
    <p className="gp-muted">{t(teamId ? "teams.profiles.teamHint" : "teams.profiles.consentHint")}</p>
    {error ? <div role="alert"><p>{error}</p><button className="tm-btn" disabled={busy} onClick={() => void act(initialize)}>{t("teams.profiles.reload")}</button></div> : null}
    <small className="gp-muted">{t("teams.profiles.limits")}</small>
    {!review && !teamId ? <div>
      <button type="button" className="tm-btn tm-btn-sm" disabled={busy} onClick={() => void act(async () => {
        const draft = await coachDraft(classId)
        if (!draft) { setDraftNote(t("teams.profiles.noDraft")); return }
        // Fields only: whether to look for a team stays the student's own choice, and nothing is published.
        setProfile(value => ({ ...value, ...draft, looking: value.looking }))
        setDraftNote(t("teams.profiles.draftLoaded"))
      })}>{t("teams.profiles.loadDraft")}</button>
      {draftNote ? <small role="status"> {draftNote}</small> : null}
    </div> : null}
    {!review ? <form className="gp-form" onSubmit={event => { event.preventDefault(); setChecked(false); setReview(true) }}>
      <div className="gp-fields">
      {tagKeys.map(key => <label key={key} className="tm-field">{t(`teams.profiles.${key}`)}<input className="tm-input" maxLength={960} value={profile[key].join(", ")} onChange={event => setProfile(value => ({ ...value, [key]: event.target.value.split(",") }))} /></label>)}
      <label className="tm-field">{t("teams.profiles.timezone")}<input className="tm-input" maxLength={80} value={profile.timezone} onChange={event => setProfile(value => ({ ...value, timezone: event.target.value }))} /></label>
      <label className="tm-field">{t("teams.profiles.hours")}<input className="tm-input" type="number" min={1} max={40} value={profile.hours_per_week ?? ""} onChange={event => setProfile(value => ({ ...value, hours_per_week: event.target.value ? Number(event.target.value) : null }))} /></label>
      </div>
      <p className="gp-h3">{t("teams.profiles.meetings")}</p>
      <div className="gp-times"><select aria-label={t("teams.profiles.day")} className="tm-input" value={day} onChange={event => setDay(Number(event.target.value))}>{dayKeys.map((key, index) => <option key={index} value={index}>{t(key)}</option>)}</select>
        <select aria-label={t("teams.profiles.hour")} className="tm-input" value={hour} onChange={event => setHour(Number(event.target.value))}>{Array.from({ length: 24 }, (_, index) => <option key={index} value={index}>{String(index).padStart(2, "0")}:00</option>)}</select>
        <button type="button" className="tm-btn" disabled={profile.meeting_slots.length >= 56} onClick={() => setProfile(value => ({ ...value, meeting_slots: Array.from(new Set([...value.meeting_slots, day * 24 + hour])).sort((a, b) => a - b) }))}>{t("teams.profiles.addTime")}</button></div>
      <div className="flex flex-wrap gap-2">{profile.meeting_slots.map(slot => <button type="button" className="tm-btn tm-btn-sm" key={slot} onClick={() => setProfile(value => ({ ...value, meeting_slots: value.meeting_slots.filter(item => item !== slot) }))}>{slotName(slot)} ×</button>)}</div>
      {!teamId ? <label className="tm-field"><input type="checkbox" checked={profile.looking} onChange={event => setProfile(value => ({ ...value, looking: event.target.checked }))} /> {t("teams.profiles.looking")}</label>
        : classProject ? <label className="tm-field"><input type="checkbox" checked={discovery} onChange={event => setDiscovery(event.target.checked)} /> {t("teams.profiles.teamDiscovery")}</label> : null}
      <button className="tm-btn" disabled={busy}>{t("teams.profiles.review")}</button>
    </form> : <div className="tm-card">
      <h4>{t("teams.profiles.review")}</h4>
      {tagKeys.map(key => <p key={key}>{t(`teams.profiles.${key}`)}: <bdi>{split(profile[key].join(",")).join(", ") || "—"}</bdi></p>)}
      <p>{t("teams.profiles.timezone")}: <bdi>{profile.timezone || "—"}</bdi> · {t("teams.profiles.hours")}: {profile.hours_per_week ?? "—"}</p>
      <p>{profile.meeting_slots.map(slotName).join(", ") || t("teams.profiles.unknownSchedule")}</p>
      <p>{t((teamId ? discovery : profile.looking) ? (teamId ? "teams.profiles.teamDiscovery" : "teams.profiles.looking") : "teams.profiles.discoveryOff")}</p>
      <label><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} /> {t(teamId ? "teams.profiles.teamConfirm" : "teams.profiles.confirm")}</label>
      <div className="flex gap-2"><button className="tm-btn" disabled={busy || !checked} onClick={() => void act(async () => {
        const clean = { ...profile }
        for (const key of tagKeys) clean[key] = split(profile[key].join(","))
        if (teamId) await api.publishTeamProfile(teamId, version, clean, discovery)
        else await api.publishProfile(classId, version, clean)
        await initialize()
      })}>{t("teams.profiles.publish")}</button><button className="tm-btn" disabled={busy} onClick={() => setReview(false)}>{t("teams.profiles.edit")}</button></div>
    </div>}
    {published ? <button className="tm-btn" disabled={busy} onClick={() => void act(async () => {
      if (teamId) await api.withdrawTeamProfile(teamId, version); else await api.withdrawProfile(classId, version)
      await initialize()
    })}>{t("teams.profiles.withdraw")}</button> : null}
    </section>
    {teamId ? <section className="gp-pcard"><button className="tm-btn" disabled={busy} onClick={() => void act(async () => setTeammates(await api.teamProfiles(teamId)))}>{t("teams.profiles.refreshTeam")}</button>
      {teammates.map(member => <div className="tm-card" key={member.account_id}><h4><bdi>{member.display_name}</bdi></h4>{tagKeys.map(key => <p key={key}>{t(`teams.profiles.${key}`)}: <bdi>{member.profile[key].join(", ") || "—"}</bdi></p>)}</div>)}</section> : <section className="gp-pcard">
      <h3 className="gp-h2">{t("teams.gp.findTitle")}</h3><p className="gp-muted">{t("teams.profiles.privateHint")}</p>
      <div className="gp-fields">
      {(["desired_skills", "required_skills", "required_languages"] as const).map(key => <label className="tm-field" key={key}>{t(`teams.profiles.${key}`)}<input className="tm-input" maxLength={960} value={preferences[key].join(", ")} onChange={event => { clearMatches(); setPreferences(value => ({ ...value, [key]: event.target.value.split(",") })) }} /></label>)}
      <label className="tm-field">{t("teams.profiles.minHours")}<input className="tm-input" type="number" min={1} max={40} value={preferences.min_hours ?? ""} onChange={event => { clearMatches(); setPreferences(value => ({ ...value, min_hours: event.target.value ? Number(event.target.value) : null })) }} /></label>
      <label className="tm-field">{t("teams.profiles.teamSize")}<input className="tm-input" type="number" min={2} max={6} value={preferences.team_size} onChange={event => { clearMatches(); setPreferences(value => ({ ...value, team_size: Number(event.target.value) })) }} /></label>
      </div>
      <label className="tm-field gp-check"><input type="checkbox" checked={requireMeeting} onChange={event => { clearMatches(); setRequireMeeting(event.target.checked) }} /> {t("teams.profiles.requireMeeting")}</label>
      <label className="tm-field">{t("teams.classes.assignment")}<select className="tm-input" value={assignment} onChange={event => { setAssignment(event.target.value); clearMatches() }}><option value="">{t("teams.profiles.chooseAssignment")}</option>{assignments.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <div className="gp-actions"><button className="tm-btn tm-btn-primary" disabled={busy || !published || !assignment} onClick={() => void act(async () => { await savePreferences(); setMatches(await api.profileMatches(classId, assignment)) })}>{t("teams.profiles.find")}</button>
      <button className="tm-btn" disabled={busy || !published || !assignment} onClick={() => void act(async () => { await savePreferences(); setTeamMatches(await api.existingTeamMatches(classId, assignment)) })}>{t("teams.profiles.findTeams")}</button></div>
      {matches ? <div><p>{t("teams.profiles.matchHint")}</p>{matches.bounded ? <p>{t("teams.profiles.bounded")}</p> : null}
        {!matches.teams.length ? <p>{t("teams.profiles.noMatches")}</p> : null}
        {matches.teams.map((team, index) => <div className="tm-card" key={index}>{team.members.map(member => <button className="tm-btn" disabled={busy} key={member.account_id} onClick={() => void act(async () => setCandidate({ account_id: member.account_id, ...await api.candidateProfile(classId, member.account_id, member.version) }))}><bdi>{member.display_name}</bdi></button>)}{factors(team)}</div>)}
      </div> : null}
      {teamMatches ? <div><p>{t("teams.profiles.existingHint")}</p>{teamMatches.bounded ? <p>{t("teams.profiles.bounded")}</p> : null}
        {!teamMatches.teams.length ? <p>{t("teams.profiles.noMatches")}</p> : null}
        {teamMatches.teams.map(team => <div className="tm-card" key={team.team_id}><h4><bdi>{team.team_name}</bdi></h4><p dir="auto">{team.summary}</p><p dir="auto">{team.roles.join(", ")} · {team.commitment}</p><p>{t("teams.openings.places", { count: team.places })}</p>
          {factors(team)}<p>{t("teams.profiles.unknownProfiles", { count: team.unknown_profiles })}</p>
          <button className="tm-btn" disabled={busy || requested.includes(team.team_id)} onClick={() => void act(async () => { const request = await api.requestJoin(team.team_id, "", team.snapshot); if (request.status === "pending") setRequested(value => [...value, team.team_id]); else throw new Error(t(`teams.openings.status.${request.status}`)) })}>{t(requested.includes(team.team_id) ? "teams.openings.status.pending" : "teams.openings.request")}</button>
        </div>)}</div> : null}
    </section>}
    {candidate ? <div className="tm-card"><h4><bdi>{candidate.display_name}</bdi></h4>{tagKeys.map(key => <p key={key}>{t(`teams.profiles.${key}`)}: <bdi>{candidate.profile[key].join(", ") || "—"}</bdi></p>)}</div> : null}
  </div>
}
