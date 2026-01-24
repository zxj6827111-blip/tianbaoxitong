import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { FileUpload } from '../components/workbench/FileUpload';
import { ManualInputsForm } from '../components/workbench/ManualInputsForm';
import { LineItemsEditor } from '../components/workbench/LineItemsEditor';
import { ValidationPanel } from '../components/workbench/ValidationPanel';
import { ReportGenerator } from '../components/workbench/ReportGenerator';
import { apiClient } from '../utils/apiClient';
import { useToast } from '../hooks/use-toast';
import { ToastContainer } from '../components/ui/Toast';
import { LogOut, Upload, FileText, CheckCircle, FileOutput, User, AlertTriangle, Settings } from 'lucide-react';

type WorkflowStep = 'upload' | 'fill' | 'validate' | 'generate';

export const WorkbenchPage: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [currentStep, setCurrentStep] = useState<WorkflowStep>('upload');
  const [draftId, setDraftId] = useState<number | null>(null);
  const [fatalCount, setFatalCount] = useState(0);

  const handleUploadComplete = (newDraftId: number) => {
    setDraftId(newDraftId);
    setCurrentStep('fill');
    toast.success('文件上传成功,已创建草稿');
  };

  const handleUploadError = (error: string) => {
    toast.error(error);
  };

  const handleManualInputsSave = async (inputs: any[]) => {
    if (!draftId) return;
    try {
      await apiClient.updateManualInputs(draftId, { inputs });
      toast.success('补录信息保存成功');
    } catch (error) {
      toast.error('保存失败,请重试');
      throw error;
    }
  };

  const handleValidate = () => {
    toast.info('校验完成');
  };

  const handleGenerate = (reportVersionId: number) => {
    toast.success(`报告生成成功! 版本ID: ${reportVersionId}`);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const steps = [
    { key: 'upload', label: '上传文件', icon: Upload },
    { key: 'fill', label: '数据填报', icon: FileText },
    { key: 'validate', label: '校验', icon: CheckCircle },
    { key: 'generate', label: '生成报告', icon: FileOutput },
  ];

  const getStepIndex = (step: WorkflowStep) => steps.findIndex((s) => s.key === step);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <ToastContainer toasts={toast.toasts} onRemove={toast.removeToast} />

      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md sticky top-0 z-50 border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center text-white font-bold text-lg shadow-sm">
              T
            </div>
            <h1 className="text-lg font-bold text-slate-900 tracking-tight">预决算报告智能生成系统</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-full border border-slate-200">
              <User className="w-4 h-4 text-slate-500" />
              <span className="text-sm font-medium text-slate-700">
                {user?.username} <span className="text-slate-400">({user?.role})</span>
              </span>
            </div>
            <button
              onClick={() => navigate('/admin')}
              className="flex items-center gap-2 px-3 py-2 text-slate-600 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors duration-200 text-sm font-medium"
              title="管理后台"
            >
              <Settings className="w-4 h-4" />
              <span>管理后台</span>
            </button>
            <button
              onClick={handleLogout}
              className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors duration-200"
              title="退出登录"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8 w-full">
        {/* Progress Stepper */}
        <div className="mb-8">
          <nav aria-label="Progress">
            <ol role="list" className="bg-white rounded-xl shadow-sm border border-slate-200 divide-y divide-slate-200 md:flex md:divide-y-0 text-sm font-medium">
              {steps.map((step, index) => {
                const stepIdx = getStepIndex(step.key as WorkflowStep);
                const currentIdx = getStepIndex(currentStep);
                const isCompleted = stepIdx < currentIdx;
                const isCurrent = step.key === currentStep;
                const isDisabled = step.key !== 'upload' && !draftId;
                
                return (
                  <li key={step.key} className="relative md:flex-1 md:flex">
                     <button
                        onClick={() => {
                          if (!isDisabled && (step.key === 'upload' || (draftId && stepIdx <= currentIdx))) {
                             setCurrentStep(step.key as WorkflowStep);
                          }
                        }}
                        disabled={isDisabled}
                        className={`group flex items-center w-full py-4 px-6 text-left transition-colors cursor-pointer focus:outline-none
                          ${isCurrent ? 'border-b-2 border-brand-600 md:border-b-0 md:border-t-4 md:border-t-brand-600' : 'md:border-t-4 md:border-t-transparent'} 
                          ${isDisabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-slate-50'}
                        `}
                      >
                      <span className={`
                        flex items-center justify-center w-10 h-10 rounded-full shrink-0 border-2 transition-colors mr-4
                        ${isCurrent || isCompleted ? 'border-brand-600 bg-brand-50' : 'border-slate-300'}
                      `}>
                         <step.icon className={`w-5 h-5 ${isCurrent || isCompleted ? 'text-brand-600' : 'text-slate-400'}`} />
                      </span>
                      <div className="flex flex-col">
                        <span className={`text-sm font-bold tracking-wide uppercase ${isCurrent ? 'text-brand-600' : 'text-slate-500'}`}>
                          Step {index + 1}
                        </span>
                        <span className={`text-base font-medium ${isCurrent ? 'text-slate-900 ml-0.5' : 'text-slate-500'}`}>
                          {step.label}
                        </span>
                      </div>
                    </button>
                    {index !== steps.length - 1 && (
                      <div className="hidden md:block absolute top-0 right-0 h-full w-px bg-slate-200" aria-hidden="true" />
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          {/* Left Column - Form/Action Area */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 sm:p-8 animate-fade-in relative overflow-hidden">
               {/* Decorative background element */}
               <div className="absolute top-0 right-0 -mt-10 -mr-10 w-40 h-40 bg-brand-50 rounded-full blur-3xl opacity-50 pointer-events-none"></div>

              {currentStep === 'upload' && (
                <>
                  <h2 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                    <span className="w-1 h-6 bg-brand-600 rounded-full inline-block"></span>
                    上传预算Excel文件
                  </h2>
                  <FileUpload
                    onUploadComplete={handleUploadComplete}
                    onError={handleUploadError}
                  />
                </>
              )}

              {currentStep === 'fill' && draftId && (
                <div className="space-y-8">
                  <section>
                    <h2 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                       <span className="w-1 h-6 bg-brand-600 rounded-full inline-block"></span>
                       人工补录信息
                    </h2>
                    <ManualInputsForm draftId={draftId} onSave={handleManualInputsSave} />
                  </section>
                  
                  <div className="border-t border-slate-100 my-6"></div>

                  <section>
                     <h2 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                       <span className="w-1 h-6 bg-brand-600 rounded-full inline-block"></span>
                       行项目编辑
                    </h2>
                    <LineItemsEditor draftId={draftId} />
                  </section>
                </div>
              )}

              {currentStep === 'validate' && draftId && (
                <>
                  <h2 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                     <span className="w-1 h-6 bg-brand-600 rounded-full inline-block"></span>
                     数据校验
                  </h2>
                  <ValidationPanel
                    draftId={draftId}
                    onValidate={() => {
                      handleValidate();
                      apiClient.getIssues(draftId).then((response) => {
                        const fatal = response.issues?.filter((i: any) => i.level === 'FATAL').length || 0;
                        setFatalCount(fatal);
                      });
                    }}
                  />
                </>
              )}

              {currentStep === 'generate' && draftId && (
                <>
                  <h2 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                     <span className="w-1 h-6 bg-brand-600 rounded-full inline-block"></span>
                     生成报告
                  </h2>
                  <ReportGenerator
                    draftId={draftId}
                    fatalCount={fatalCount}
                    onGenerate={handleGenerate}
                  />
                </>
              )}
            </div>
          </div>

          {/* Right Column - Status & Help */}
          <div className="space-y-6 lg:sticky lg:top-24">
            {/* Status Card */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h3 className="text-sm font-bold text-slate-900 text-uppercase tracking-wider mb-4 border-b border-slate-100 pb-2">
                当前状态
              </h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center text-sm group">
                  <span className="text-slate-500">草稿 ID</span>
                  <span className="font-mono font-medium text-slate-900 bg-slate-100 px-2 py-1 rounded text-xs group-hover:bg-brand-50 group-hover:text-brand-700 transition-colors">
                    {draftId ? `#${draftId}` : '未创建'}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-500">当前步骤</span>
                  <span className="font-medium text-brand-600 px-2 py-1 bg-brand-50 rounded-full text-xs">
                    {steps.find((s) => s.key === currentStep)?.label}
                  </span>
                </div>
                {fatalCount > 0 && (
                  <div className="p-3 bg-red-50 border border-red-100 rounded-lg flex gap-3 items-start mt-2">
                    <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                    <div>
                       <p className="text-sm font-bold text-red-800">校验未通过</p>
                       <p className="text-xs text-red-600 mt-1">发现 {fatalCount} 个严重错误 (FATAL)</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Help Card */}
            <div className="bg-slate-50/50 rounded-xl border border-slate-200/60 p-6">
               <h3 className="text-sm font-bold text-slate-700 text-uppercase tracking-wider mb-4">
                操作指南
              </h3>
              <div className="text-sm text-slate-600 space-y-3">
                 {currentStep === 'upload' && (
                  <div className="prose prose-sm prose-slate">
                     <p className="mb-2">请按照模板要求上传 Excel 文件：</p>
                     <ul className="list-disc list-inside space-y-1 pl-1 marker:text-brand-400">
                        <li>选择正确的年度和口径</li>
                        <li>支持 .xlsx 格式文件</li>
                        <li>系统将自动解析并在成功后跳转</li>
                     </ul>
                  </div>
                 )}
                 {currentStep === 'fill' && (
                    <div className="prose prose-sm prose-slate">
                      <p className="mb-2">请完善必要的信息：</p>
                      <ul className="list-disc list-inside space-y-1 pl-1 marker:text-brand-400">
                         <li>红色星号 (*) 为必填项</li>
                         <li>政府采购、绩效、资产信息需准确填写</li>
                         <li>如金额变动较大，需说明原因</li>
                      </ul>
                   </div>
                 )}
                 {currentStep === 'validate' && (
                    <div className="prose prose-sm prose-slate">
                      <p className="mb-2">系统将检查数据一致性：</p>
                      <ul className="list-disc list-inside space-y-1 pl-1 marker:text-brand-400">
                         <li><strong className="text-red-600">FATAL</strong>: 必须修复的阻断性错误</li>
                         <li><strong className="text-amber-600">WARNING</strong>: 可能存在问题，建议确认</li>
                         <li>点击"重新校验"以刷新结果</li>
                      </ul>
                   </div>
                 )}
                 {currentStep === 'generate' && (
                    <div className="prose prose-sm prose-slate">
                      <p className="mb-2">生成最终报告：</p>
                       <ul className="list-disc list-inside space-y-1 pl-1 marker:text-brand-400">
                         <li>必须解决所有 FATAL 错误</li>
                         <li>生成后可下载 PDF 和数据底稿</li>
                         <li>生成的报告将保存并在历史记录中可查</li>
                      </ul>
                   </div>
                 )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
