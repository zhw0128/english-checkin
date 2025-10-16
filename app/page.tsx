'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient'; // ← 确认你的实际路径（@/lib 或 @/utils）

type Lesson = {
  id: number;
  title: string;
  description: string | null;
  audio_path: string | null;  // 形如 "lessons/Level3Reading1A.mp3"
  doc_path: string | null;    // 形如 "lessons/1A.pdf"
  published: boolean;
};

/** 设备匿名 ID（保存在 localStorage） */
function getCid() {
  let cid = localStorage.getItem('cid');
  if (!cid) {
    cid = `anon_${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem('cid', cid);
  }
  return cid;
}

export default function Home() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('lessons')
      .select('*')
      .eq('published', true)
      .then(({ data, error }) => {
        if (error) console.error(error);
        setLessons(data || []);
        setLoading(false);
      });
  }, []);

  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: 16 }}>
      <h1>🎧 English Listening Check-in</h1>

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
            {lsn.description && <p>{lsn.description}</p>}
            <LessonCard lesson={lsn} />
          </li>
        ))}
      </ul>
    </main>
  );
}

function LessonCard({ lesson }: { lesson: Lesson }) {
  const [audioUrl, setAudioUrl] = useState('');
  const [docUrl, setDocUrl] = useState('');
  const [recording, setRecording] = useState(false);
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [chunks, setChunks] = useState<Blob[]>([]);
  const [listened, setListened] = useState(false);

  /** 加载音频/PDF 公网地址 */
  useEffect(() => {
    // 音频
    if (lesson.audio_path) {
      const [bucket, ...p] = lesson.audio_path.split('/');
      const filePath = p.join('/');
      const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
      setAudioUrl(data.publicUrl || '');
    } else {
      setAudioUrl('');
    }

    // PDF
    if (lesson.doc_path) {
      const [dbucket, ...dp] = lesson.doc_path.split('/');
      const filePath = dp.join('/');
      const { data } = supabase.storage.from(dbucket).getPublicUrl(filePath);
      setDocUrl(data.publicUrl || '');
    } else {
      setDocUrl('');
    }
  }, [lesson.audio_path, lesson.doc_path]);

  /** 进页面时检查这台设备是否已“听完” */
  useEffect(() => {
    const cid = getCid();
    supabase
      .from('listens')
      .select('id', { head: true, count: 'exact' }) // 只要数量
      .eq('lesson_id', lesson.id)
      .eq('cid', cid)
      .then(({ count, error }) => {
        if (!error && (count ?? 0) > 0) setListened(true);
      });
  }, [lesson.id]);

  /** 播放结束，打点已完成（去重 upsert） */
  async function markListen() {
    try {
      const cid = getCid();
      const { error } = await supabase
        .from('listens')
        .upsert(
          [{ lesson_id: lesson.id, cid }],
          { onConflict: 'lesson_id,cid' } // 需要你在 listens 表上建唯一索引 (lesson_id,cid)
        );
      if (error) console.warn('markListen warn:', error);
      setListened(true);
    } catch (e) {
      console.error(e);
    }
  }

  /** 开始录音 */
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

      const cid = getCid(); // 已是 anon_xxx
      // 路径建议：<cid>/<lesson_id>/<timestamp>.webm
      const path = `${cid}/${lesson.id}/${Date.now()}.webm`;

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

  /** 停止录音 */
  function stopRec() {
    rec?.stop();
    setRecording(false);
  }

  return (
    <div>
      {audioUrl ? (
        <audio controls src={audioUrl} onEnded={markListen} />
      ) : (
        <em>暂无音频</em>
      )}

      {listened && (
        <p style={{ color: '#16a34a', marginTop: 8 }}>已完成听读 ✅</p>
      )}

      {docUrl && (
        <p style={{ marginTop: 8 }}>
          <a href={docUrl} target="_blank" rel="noreferrer">
            📄 查看讲义（PDF）
          </a>
        </p>
      )}

      <div style={{ marginTop: 8 }}>
        {!recording ? (
          <button onClick={startRec}>🎤 开始录音</button>
        ) : (
          <button onClick={stopRec}>⏹ 停止录音并上传</button>
        )}
      </div>
    </div>
  );
}
