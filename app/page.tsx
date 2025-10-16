function getCid() {
  let cid = localStorage.getItem('cid');
  if (!cid) {
    cid = `anon_${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem('cid', cid);
  }
  return cid;
}

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
  const [listened, setListened] = useState(false);
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
    useEffect(() => {
    const cid = getCid();
    supabase
      .from('listens')
      .select('id', { head: true, count: 'exact' }) // 只返回数量，不取内容
      .eq('lesson_id', lesson.id)
      .eq('cid', cid)
      .then(({ count, error }) => {
        if (!error && (count ?? 0) > 0) setListened(true);
      });
  }, [lesson.id]);

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
{listened && (
  <p style={{ color: '#16a34a', marginTop: 8 }}>已完成听读 ✅</p>
)}

  // 📄 PDF 链接
  if (lesson.doc_path) {
    const [dbucket, ...dp] = lesson.doc_path.split('/');
    const filePath = dp.join('/');
    const { data } = supabase.storage.from(dbucket).getPublicUrl(filePath);
    setDocUrl(data.publicUrl || '');
  }
}, [lesson.audio_path, lesson.doc_path]);


  async function markListen() {
  try {
    const cid = getCid();

    // 用 upsert，配合上面的唯一索引 (lesson_id,cid) 防重复
    const { error } = await supabase
      .from('listens')
      .upsert(
        [{ lesson_id: lesson.id, cid }],
        { onConflict: 'lesson_id,cid' }
      );

    if (error) {
      console.warn('markListen warn:', error);
      // 不阻止 UI，避免学生体验受影响
    }

    setListened(true);
  } catch (e: any) {
    console.error(e);
  }
}

  async function startRec() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mr = new MediaRecorder(stream);
  setChunks([]);

  mr.ondataavailable = (e) => setChunks((prev) => [...prev, e.data]);

  mr.onstop = async () => {
  const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
  const file = new File([blob], `reading-${Date.now()}.webm`, { type: blob.type });

  // 匿名唯一ID（存在 localStorage）
  const cid =
    localStorage.getItem('cid') ??
    (() => {
      const v = `anon_${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem('cid', v);
      return v;
    })();

  // 文件路径结构： recordings/anon_xxx/<lesson.id>/<时间戳>.webm
  const lessonId = lesson?.id ?? 'unknown';
  const path = `anon_${cid}/${lessonId}/${Date.now()}.webm`;

  try {
    const { error } = await supabase.storage
      .from('recordings')
      .upload(path, file, { contentType: 'audio/webm' });

    if (error) throw error;
    alert('录音已上传 ✅');
  } catch (err) {
    console.error('上传失败:', err);
    alert('上传失败 ❌');
  }
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
  onEnded={() => markListened(lesson.id)}
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
