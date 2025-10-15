'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Lesson = {
  id: number;
  title: string;
  description: string | null;
  audio_path: string | null;
  doc_path: string | null;
  published: boolean;
};

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    supabase
      .from('lessons')
      .select('*')
      .eq('published', true)
      .then(({ data }) => {
        setLessons(data || []);
        setLoading(false);
      });
  }, []);

  async function signIn() {
    const email = prompt('请输入邮箱（将收到登录链接）');
    if (!email) return;
    const { error } = await supabase.auth.signInWithOtp({ email });
    alert(error ? error.message : '登录链接已发送，请查收邮箱');
  }

  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: 16 }}>
      <h1>🎧 English Listening Check-in</h1>
      {!user && <button onClick={signIn}>邮箱登录</button>}
      {user && <p>Hi, {user.email}</p>}

      {loading && <p>正在加载课程...</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {lessons.map((lsn) => (
          <li
            key={lsn.id}
            style={{
              border: '1px solid #ddd',
              borderRadius: 8,
              marginTop: 16,
              padding: 16,
            }}
          >
            <h3>{lsn.title}</h3>
            <p>{lsn.description}</p>
            <LessonCard lesson={lsn} user={user} />
          </li>
        ))}
      </ul>
    </main>
  );
}

function LessonCard({ lesson, user }: { lesson: Lesson; user: any }) {
  const [audioUrl, setAudioUrl] = useState('');
  const [docUrl, setDocUrl] = useState('');
  const [recording, setRecording] = useState(false);
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [chunks, setChunks] = useState<Blob[]>([]);

  useEffect(() => {
  // 🎧 音频链接
  if (lesson.audio_path) {
    const [bucket, ...p] = lesson.audio_path.split('/');
    const filePath = p.join('/');
    const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
    setAudioUrl(data.publicUrl || '');
  }

  // 📄 PDF 链接
  if (lesson.doc_path) {
    const [dbucket, ...dp] = lesson.doc_path.split('/');
    const filePath = dp.join('/');
    const { data } = supabase.storage.from(dbucket).getPublicUrl(filePath);
    setDocUrl(data.publicUrl || '');
  }
}, [lesson.audio_path, lesson.doc_path]);


  async function markListen() {
    if (!user) return alert('请先登录');
    const today = new Date().toISOString().slice(0, 10);
    await supabase.from('listens').insert({
      user_id: user.id,
      lesson_id: lesson.id,
      listened_at: today,
    });
    alert('听完已记录 ✅');
  }

  async function startRec() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream);
    setChunks([]);
    mr.ondataavailable = (e) => setChunks((prev) => [...prev, e.data]);
    mr.onstop = async () => {
      const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
      const file = new File([blob], `reading-${Date.now()}.webm`, {
        type: blob.type,
      });
      const path = `user-${user.id}/${file.name}`;
      await supabase.storage.from('readings').upload(path, file);
      await supabase.from('readings').insert({
        user_id: user.id,
        lesson_id: lesson.id,
        file_path: `readings/${path}`,
      });
      alert('录音已上传 ✅');
    };
    mr.start();
    setRec(mr);
    setRecording(true);
  }

  function stopRec() {
    rec?.stop();
    setRecording(false);
  }

  return (
    <div>
      {audioUrl ? (
        <audio
          controls
          src={audioUrl}
          onEnded={markListen}
          style={{ width: '100%' }}
        />
      ) : (
        <em>暂无音频</em>
      )}
      {docUrl && (
  <p style={{ marginTop: 8 }}>
    <a href={docUrl} target="_blank" rel="noreferrer">
      📄 查看讲义（PDF）
    </a>
  </p>
)}

      <div style={{ marginTop: 8 }}>
        {!recording && <button onClick={startRec}>🎤 开始录音</button>}
        {recording && <button onClick={stopRec}>⏹ 停止录音并上传</button>}
      </div>
    </div>
  );
}
