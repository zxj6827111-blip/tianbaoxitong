import React, { useState, useEffect } from 'react';
import { Upload, FileText, Calendar, User, Download } from 'lucide-react';

interface ArchivePanelProps {
  departmentId: string;
  year: number;
}

interface Report {
  id: string;
  report_type: string;
  file_name: string;
  file_size: number;
  created_at: string;
}

interface TextContent {
  id: string;
  category: string;
  content_text: string;
  updated_at: string;
}

const ArchivePanel: React.FC<ArchivePanelProps> = ({ departmentId, year }) => {
  const [reports, setReports] = useState<Report[]>([]);
  const [textContent, setTextContent] = useState<TextContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedType, setSelectedType] = useState<'BUDGET' | 'FINAL'>('BUDGET');

  useEffect(() => {
    loadArchives();
  }, [departmentId, year]);

  const loadArchives = async () => {
    try {
      const response = await fetch(
        `/api/admin/archives/departments/${departmentId}/years/${year}`,
        {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        }
      );
      const data = await response.json();
      setReports(data.reports || []);
      setTextContent(data.text_content || []);
    } catch (error) {
      console.error('Failed to load archives:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0]) return;

    const file = e.target.files[0];
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('department_id', departmentId);
      formData.append('year', year.toString());
      formData.append('report_type', selectedType);

      const response = await fetch('/api/admin/archives/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: formData
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      await loadArchives();
    } catch (error) {
      console.error('Upload error:', error);
      alert('上传失败');
    } finally {
      setUploading(false);
    }
  };

  const saveTextContent = async (category: string, content: string) => {
    try {
      await fetch('/api/admin/archives/text-content', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          department_id: departmentId,
          year,
          category,
          content_text: content
        })
      });
      await loadArchives();
    } catch (error) {
      console.error('Save error:', error);
      alert('保存失败');
    }
  };

  if (loading) {
    return <div className="p-4 text-center text-slate-400">加载中...</div>;
  }

  return (
    <div className="space-y-6">
      {/* PDF Upload Section */}
      <div>
        <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
          <Upload className="w-4 h-4" />
          上传年度报告 PDF
        </h3>
        
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setSelectedType('BUDGET')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              selectedType === 'BUDGET'
                ? 'bg-brand-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            预算报告
          </button>
          <button
            onClick={() => setSelectedType('FINAL')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              selectedType === 'FINAL'
                ? 'bg-brand-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            决算报告
          </button>
        </div>

        <label className="block">
          <div className="border-2 border-dashed border-slate-300 rounded-lg p-4 text-center hover:border-brand-400 transition-colors cursor-pointer">
            <input
              type="file"
              accept=".pdf"
              onChange={handleFileUpload}
              disabled={uploading}
              className="hidden"
            />
            <FileText className="w-6 h-6 text-slate-400 mx-auto mb-2" />
            <p className="text-sm text-slate-600">
              {uploading ? '上传中...' : `点击上传 ${selectedType === 'BUDGET' ? '预算' : '决算'} PDF`}
            </p>
          </div>
        </label>
      </div>

      {/* Uploaded Reports */}
      {reports.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-slate-800 mb-3">已上传文件</h3>
          <div className="space-y-2">
            {reports.map((report) => (
              <div
                key={report.id}
                className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200"
              >
                <div className="flex items-center gap-3">
                  <FileText className="w-4 h-4 text-slate-400" />
                  <div>
                    <div className="text-sm font-medium text-slate-900">{report.file_name}</div>
                    <div className="text-xs text-slate-500">
                      {report.report_type === 'BUDGET' ? '预算' : '决算'} · {(report.file_size / 1024 / 1024).toFixed(2)} MB
                    </div>
                  </div>
                </div>
                <span className="text-xs text-slate-400">{new Date(report.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Text Content for Reuse */}
      <div>
        <h3 className="text-sm font-bold text-slate-800 mb-3">可复用文本内容</h3>
        <p className="text-xs text-slate-500 mb-3">
          这些内容可以在工作台的手动填报步骤中快速复用
        </p>
        
        {['FUNCTION', 'STRUCTURE', 'TERMINOLOGY'].map((category) => {
          const existing = textContent.find((tc) => tc.category === category);
          return (
            <div key={category} className="mb-4">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {category === 'FUNCTION' && '主要职能'}
                {category === 'STRUCTURE' && '机构设置'}
                {category === 'TERMINOLOGY' && '名词解释'}
              </label>
              <textarea
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
                rows={3}
                defaultValue={existing?.content_text || ''}
                placeholder={`输入${category === 'FUNCTION' ? '主要职能' : category === 'STRUCTURE' ? '机构设置' : '名词解释'}内容...`}
                onBlur={(e) => {
                  if (e.target.value.trim()) {
                    saveTextContent(category, e.target.value.trim());
                  }
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ArchivePanel;
