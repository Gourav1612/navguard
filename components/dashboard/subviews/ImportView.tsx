'use client';

import { useState, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { 
  Upload, 
  FileSpreadsheet, 
  HelpCircle, 
  CheckCircle2, 
  AlertTriangle, 
  Play, 
  Trash2, 
  Download, 
  Info,
  Loader2,
  Copy,
  Check
} from 'lucide-react';
import { BulkImportRowSchema } from '@/lib/validations';
import * as XLSX from 'xlsx';
import Link from 'next/link';

interface ImportSummary {
  total_processed: number;
  success_count: number;
  failure_count: number;
  links_succeeded: number;
  links_failed: number;
}

export default function AdminImportPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [validationResults, setValidationResults] = useState<{
    validRows: any[];
    invalidRows: { row: number; data: any; errors: string[] }[];
  }>({ validRows: [], invalidRows: [] });

  const [activeTab, setActiveTab] = useState<'preview' | 'invalid' | 'drivers' | 'parents' | 'students'>('preview');
  const [uploading, setUploading] = useState(false);
  const [importReport, setImportReport] = useState<{
    summary: ImportSummary;
    successes: any[];
    failures: any[];
    links: { successes: string[]; failures: any[] };
  } | null>(null);

  const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({});

  // Helper to copy temp password
  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedStates(prev => ({ ...prev, [key]: true }));
    setTimeout(() => {
      setCopiedStates(prev => ({ ...prev, [key]: false }));
    }, 2000);
  };

  // CSV Template Generation
  const downloadTemplate = () => {
    const headers = 'role,full_name,email,phone,password,license_number,license_expiry,grade,roll_number,parent_email\n';
    const row1 = 'driver,Rajesh Kumar,rajesh.driver@school.edu,+919876543201,DriverPass@1,DL-1420230099,2030-12-31,,,\n';
    const row2 = 'parent,Suman Sharma,suman.parent@school.edu,+919876543202,ParentPass@1,,,,,\n';
    const row3 = 'student,Amit Sharma,amit.student@school.edu,+919876543203,StudentPass@1,,,,10-A,42,suman.parent@school.edu\n';
    
    const blob = new Blob([headers + row1 + row2 + row3], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'naviguard_bulk_import_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Excel Template Generation
  const downloadXLSXTemplate = () => {
    const headers = ['role', 'full_name', 'email', 'phone', 'password', 'license_number', 'license_expiry', 'grade', 'roll_number', 'parent_email'];
    const row1 = ['driver', 'Rajesh Kumar', 'rajesh.driver@school.edu', '+919876543201', 'DriverPass@1', 'DL-1420230099', '2030-12-31', '', '', ''];
    const row2 = ['parent', 'Suman Sharma', 'suman.parent@school.edu', '+919876543202', 'ParentPass@1', '', '', '', '', ''];
    const row3 = ['student', 'Amit Sharma', 'amit.student@school.edu', '+919876543203', 'StudentPass@1', '', '', '10-A', '42', 'suman.parent@school.edu'];
    
    const worksheet = XLSX.utils.aoa_to_sheet([headers, row1, row2, row3]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Bulk Import Template');
    XLSX.writeFile(workbook, 'naviguard_bulk_import_template.xlsx');
  };

  // CSV/Excel Parsing Flow Coordinator
  const handleExcelOrCSVParsing = (file: File) => {
    const reader = new FileReader();

    if (file.name.endsWith('.csv')) {
      reader.onload = (event) => {
        if (event.target?.result) {
          handleCSVParsing(event.target.result as string);
        }
      };
      reader.readAsText(file);
    } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
      reader.onload = (event) => {
        if (event.target?.result) {
          try {
            const data = new Uint8Array(event.target.result as ArrayBuffer);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            
            // Read raw JSON from sheet, with headers mapping
            const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { defval: '' });
            
            // Normalize headers to lowercase to match validation schemas
            const normalizedRows = rawRows.map(row => {
              const newRow: any = {};
              Object.entries(row).forEach(([key, val]) => {
                const cleanKey = key.trim().toLowerCase();
                let cleanVal = String(val).trim();
                if (cleanVal === 'null' || cleanVal === 'undefined') cleanVal = '';
                newRow[cleanKey] = cleanVal;
              });
              return newRow;
            });

            processParsedRows(normalizedRows);
          } catch (err: any) {
            alert(`Failed to parse Excel file: ${err.message}`);
          }
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      alert('Please upload a valid CSV or Excel (.xlsx, .xls) file.');
    }
  };

  // Shared processor for parsed rows
  const processParsedRows = (rows: any[]) => {
    setParsedRows(rows);

    // Validate rows
    const valid: any[] = [];
    const invalid: any[] = [];

    rows.forEach((row, idx) => {
      const parsed = BulkImportRowSchema.safeParse(row);
      if (parsed.success) {
        valid.push(parsed.data);
      } else {
        const errorMessages = Object.entries(parsed.error.format())
          .filter(([key]) => key !== '_errors')
          .map(([key, val]: any) => `${key}: ${val._errors ? val._errors.join(', ') : 'Invalid format'}`);

        invalid.push({
          row: idx + 2, // 1-based index + header offset
          data: row,
          errors: errorMessages
        });
      }
    });

    setValidationResults({ validRows: valid, invalidRows: invalid });
    setImportReport(null);
    if (invalid.length > 0) {
      setActiveTab('invalid');
    } else {
      setActiveTab('preview');
    }
  };

  // CSV Parsing Logic
  const handleCSVParsing = (text: string) => {
    const lines = text.split(/\r?\n/);
    if (lines.length === 0) return;

    // Parse headers cleanly
    const rawHeaders = lines[0].split(',');
    const headers = rawHeaders.map(h => h.trim().replace(/^["']|["']$/g, '').toLowerCase());

    const rows: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Handle quotes in CSV columns
      const values: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"' || char === "'") {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim());

      const rowObj: any = {};
      headers.forEach((header, index) => {
        let val = values[index] !== undefined ? values[index].replace(/^["']|["']$/g, '') : '';
        if (val === 'null' || val === 'undefined') val = '';
        rowObj[header] = val;
      });
      rows.push(rowObj);
    }

    processParsedRows(rows);
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleExcelOrCSVParsing(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleExcelOrCSVParsing(e.target.files[0]);
    }
  };

  const clearData = () => {
    setParsedRows([]);
    setValidationResults({ validRows: [], invalidRows: [] });
    setImportReport(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const executeBulkImport = async () => {
    if (validationResults.validRows.length === 0) return;
    setUploading(true);
    setImportReport(null);

    try {
      const res = await fetch('/api/admin/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: validationResults.validRows }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to execute bulk import');
      }

      setImportReport(data);
      // Clear preview state on successful upload completion
      setParsedRows([]);
      setValidationResults({ validRows: [], invalidRows: [] });
    } catch (err: any) {
      alert(err.message || 'An error occurred during bulk import.');
    } finally {
      setUploading(false);
    }
  };

  const drivers = validationResults.validRows.filter(r => r.role === 'driver');
  const parents = validationResults.validRows.filter(r => r.role === 'parent');
  const students = validationResults.validRows.filter(r => r.role === 'student');

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-12 animate-in fade-in duration-200">
      {/* Page Header */}
      <div>
        <h2 className="text-2xl font-black text-slate-900 tracking-tight">Bulk Import Center</h2>
        <p className="text-slate-500 text-sm font-medium">Bulk register Drivers, Parents, and Students via CSV files with automated linking.</p>
      </div>

      {/* Info & Template section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 bg-slate-900 text-slate-100 p-6 rounded-2xl border border-slate-800 shadow-sm flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <h3 className="font-bold text-sm tracking-wide text-slate-200 flex items-center gap-2">
              <Info className="w-4 h-4 text-primary" />
              CSV Format Specifications
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Your CSV file must include the headers exactly as shown in the template. Required fields vary depending on the selected user role:
            </p>
            <ul className="text-xs text-slate-400 space-y-1.5 list-disc pl-5 leading-relaxed">
              <li><strong>Common fields</strong>: <code className="text-slate-200 font-mono font-bold">role</code>, <code className="text-slate-200 font-mono font-bold">full_name</code>, <code className="text-slate-200 font-mono font-bold">email</code>, <code className="text-slate-200 font-mono font-bold">phone</code>, <code className="text-slate-200 font-mono font-bold">password</code></li>
              <li><strong>Drivers</strong>: Requires <code className="text-slate-200 font-mono font-bold">license_number</code> and optionally <code className="text-slate-200 font-mono font-bold">license_expiry</code> (YYYY-MM-DD format).</li>
              <li><strong>Students</strong>: Requires <code className="text-slate-200 font-mono font-bold">grade</code>, <code className="text-slate-200 font-mono font-bold">roll_number</code>, and optionally <code className="text-slate-200 font-mono font-bold">parent_email</code> (to auto-link the student to their guardian).</li>
            </ul>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={downloadTemplate}
              className="inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs py-2.5 px-4 rounded-xl border border-slate-700 hover:border-slate-650 transition cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Download CSV Template
            </button>
            <button
              type="button"
              onClick={downloadXLSXTemplate}
              className="inline-flex items-center gap-2 bg-emerald-800 hover:bg-emerald-700 text-white font-semibold text-xs py-2.5 px-4 rounded-xl border border-emerald-700 hover:border-emerald-650 transition cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Download Excel Template
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-150 p-6 rounded-2xl shadow-sm flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <h3 className="font-bold text-sm tracking-tight text-slate-800 flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-violet-500" />
              Manual Administration
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Need to add only a single operator? You can still use the dedicated manual administration pages to create, assign, or edit operators individually.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Link href="/dashboard?tab=drivers" className="text-[10px] font-bold uppercase tracking-wider text-slate-600 border border-slate-200 hover:bg-slate-50 py-1.5 px-2.5 rounded-lg transition">Drivers</Link>
            <Link href="/dashboard?tab=parents" className="text-[10px] font-bold uppercase tracking-wider text-slate-600 border border-slate-200 hover:bg-slate-50 py-1.5 px-2.5 rounded-lg transition">Parents</Link>
            <Link href="/dashboard?tab=students" className="text-[10px] font-bold uppercase tracking-wider text-slate-600 border border-slate-200 hover:bg-slate-50 py-1.5 px-2.5 rounded-lg transition">Students</Link>
          </div>
        </div>
      </div>

      {/* Upload area */}
      {parsedRows.length === 0 && !uploading && !importReport && (
        <div 
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleFileDrop}
          className={`flex flex-col items-center justify-center border-2 border-dashed rounded-3xl p-12 text-center transition-all min-h-[300px] cursor-pointer ${
            dragActive 
              ? 'border-primary bg-primary/5 shadow-inner' 
              : 'border-slate-250 bg-white hover:border-slate-400 hover:shadow-md'
          }`}
          onClick={() => fileInputRef.current?.click()}
        >
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileSelect} 
            accept=".csv,.xlsx,.xls" 
            className="hidden" 
          />
          <div className="flex items-center justify-center w-14 h-14 bg-slate-100 border border-slate-200 rounded-2xl text-slate-500 mb-4 transition-all">
            <Upload className="w-7 h-7" />
          </div>
          <h3 className="text-lg font-bold text-slate-800">Upload CSV or Excel file</h3>
          <p className="text-xs text-slate-400 max-w-sm mt-1 mb-5 leading-normal">
            Drag and drop your template file here, or click to browse files from your computer. Must be a valid CSV or Excel spreadsheet (.xlsx, .xls).
          </p>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest bg-slate-100 border border-slate-200 px-3 py-1 rounded-full">CSV OR EXCEL</span>
        </div>
      )}

      {/* Loading state */}
      {uploading && (
        <div className="flex flex-col items-center justify-center border border-slate-200 rounded-3xl p-16 bg-white shadow-sm space-y-4 min-h-[300px]">
          <Loader2 className="w-10 h-10 text-primary animate-spin" />
          <div className="text-center space-y-1">
            <h3 className="text-lg font-bold text-slate-800">Processing Bulk Import...</h3>
            <p className="text-xs text-slate-500 max-w-xs">Creating Auth credentials, populating profile tables, and establishing relationships.</p>
          </div>
        </div>
      )}

      {/* Preview Section */}
      {parsedRows.length > 0 && !uploading && (
        <div className="border border-slate-150 rounded-2xl bg-white shadow-sm overflow-hidden animate-in zoom-in-95 duration-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-6 border-b border-slate-150 gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-slate-100 border border-slate-200 rounded-xl text-slate-600">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900">CSV File Preview</h3>
                <p className="text-xs text-slate-500 font-medium">Review and resolve warnings before committing to the database.</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={clearData}
                className="inline-flex items-center gap-1.5 hover:bg-slate-100 text-slate-650 font-semibold text-xs py-2.5 px-4 rounded-xl transition cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                Clear
              </button>

              <button
                type="button"
                onClick={executeBulkImport}
                disabled={validationResults.validRows.length === 0}
                className="inline-flex items-center gap-2 bg-primary hover:bg-primary-dark text-white font-semibold text-xs py-2.5 px-4 rounded-xl transition shadow hover:shadow-lg shadow-primary/25 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play className="w-3.5 h-3.5" />
                Import {validationResults.validRows.length} Rows
              </button>
            </div>
          </div>

          {/* Validation Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-5 divide-x divide-y sm:divide-y-0 divide-slate-150 border-b border-slate-150 text-center bg-slate-50/50">
            <div className="p-4">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Rows</span>
              <span className="text-2xl font-black text-slate-800 block mt-1">{parsedRows.length}</span>
            </div>
            <div className="p-4">
              <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block">Valid Rows</span>
              <span className="text-2xl font-black text-emerald-600 block mt-1">{validationResults.validRows.length}</span>
            </div>
            <div className="p-4">
              <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider block">Drivers</span>
              <span className="text-2xl font-black text-indigo-800 block mt-1">{drivers.length}</span>
            </div>
            <div className="p-4">
              <span className="text-[10px] font-bold text-violet-600 uppercase tracking-wider block">Parents</span>
              <span className="text-2xl font-black text-violet-800 block mt-1">{parents.length}</span>
            </div>
            <div className="p-4">
              <span className="text-[10px] font-bold text-red-600 uppercase tracking-wider block">Invalid Rows</span>
              <span className="text-2xl font-black text-red-650 block mt-1">{validationResults.invalidRows.length}</span>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex border-b border-slate-150 overflow-x-auto whitespace-nowrap bg-slate-50/20 px-4">
            <button
              onClick={() => setActiveTab('preview')}
              className={`px-4 py-3 text-xs font-semibold border-b-2 transition ${
                activeTab === 'preview' ? 'border-primary text-primary font-bold' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Valid Preview ({validationResults.validRows.length})
            </button>
            <button
              onClick={() => setActiveTab('invalid')}
              className={`px-4 py-3 text-xs font-semibold border-b-2 transition ${
                activeTab === 'invalid' ? 'border-red-500 text-red-650 font-bold' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Invalid / Warnings ({validationResults.invalidRows.length})
            </button>
            <button
              onClick={() => setActiveTab('drivers')}
              className={`px-4 py-3 text-xs font-semibold border-b-2 transition ${
                activeTab === 'drivers' ? 'border-indigo-500 text-indigo-700 font-bold' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Drivers ({drivers.length})
            </button>
            <button
              onClick={() => setActiveTab('parents')}
              className={`px-4 py-3 text-xs font-semibold border-b-2 transition ${
                activeTab === 'parents' ? 'border-violet-500 text-violet-700 font-bold' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Parents ({parents.length})
            </button>
            <button
              onClick={() => setActiveTab('students')}
              className={`px-4 py-3 text-xs font-semibold border-b-2 transition ${
                activeTab === 'students' ? 'border-emerald-500 text-emerald-700 font-bold' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Students ({students.length})
            </button>
          </div>

          {/* Tab Contents */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              {/* Valid Preview / Drivers / Parents / Students rendering */}
              {activeTab !== 'invalid' && (
                <>
                  <thead>
                    <tr className="bg-slate-50/75 border-b border-slate-150 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      <th className="px-6 py-3.5">Role</th>
                      <th className="px-6 py-3.5">Name</th>
                      <th className="px-6 py-3.5">Email</th>
                      <th className="px-6 py-3.5">Phone</th>
                      <th className="px-6 py-3.5">Temp Password</th>
                      <th className="px-6 py-3.5">Role Specific Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                    {(activeTab === 'preview' ? validationResults.validRows : 
                      activeTab === 'drivers' ? drivers : 
                      activeTab === 'parents' ? parents : students
                    ).length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-8 text-center text-slate-400 font-medium italic">
                          No valid rows match this filter.
                        </td>
                      </tr>
                    ) : (
                      (activeTab === 'preview' ? validationResults.validRows : 
                       activeTab === 'drivers' ? drivers : 
                       activeTab === 'parents' ? parents : students
                      ).map((row: any, i: number) => {
                        let roleColor = 'bg-slate-100 text-slate-700 border-slate-200';
                        if (row.role === 'driver') roleColor = 'bg-indigo-50 text-indigo-700 border-indigo-150';
                        else if (row.role === 'parent') roleColor = 'bg-violet-50 text-violet-700 border-violet-150';
                        else if (row.role === 'student') roleColor = 'bg-emerald-50 text-emerald-700 border-emerald-150';

                        return (
                          <tr key={i} className="hover:bg-slate-50/30 transition">
                            <td className="px-6 py-3.5">
                              <span className={`inline-flex items-center px-2 py-0.5 border rounded-md text-[9px] font-bold uppercase ${roleColor}`}>
                                {row.role}
                              </span>
                            </td>
                            <td className="px-6 py-3.5 font-bold text-slate-900">{row.full_name}</td>
                            <td className="px-6 py-3.5 font-medium text-slate-600">{row.email}</td>
                            <td className="px-6 py-3.5 text-slate-500 font-mono">{row.phone || '—'}</td>
                            <td className="px-6 py-3.5 text-slate-500 font-mono">{row.password || '(auto-generated)'}</td>
                            <td className="px-6 py-3.5">
                              {row.role === 'driver' && (
                                <div className="text-slate-500 leading-normal">
                                  Lic: <span className="font-mono text-slate-700 font-semibold">{row.license_number || 'UNKNOWN'}</span>
                                  {row.license_expiry && ` (Exp: ${row.license_expiry})`}
                                </div>
                              )}
                              {row.role === 'parent' && <span className="text-slate-400 italic">No extra fields required</span>}
                              {row.role === 'student' && (
                                <div className="text-slate-500 leading-normal">
                                  Grade: <span className="text-slate-700 font-semibold">{row.grade}</span> | Roll: <span className="text-slate-700 font-semibold font-mono">{row.roll_number}</span>
                                  {row.parent_email && <div className="text-[10px] text-slate-400">Parent: {row.parent_email}</div>}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </>
              )}

              {/* Invalid Rows Rendering */}
              {activeTab === 'invalid' && (
                <>
                  <thead>
                    <tr className="bg-slate-50/75 border-b border-slate-150 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      <th className="px-6 py-3.5 w-16">CSV Line</th>
                      <th className="px-6 py-3.5 w-1/3">Raw Row Content</th>
                      <th className="px-6 py-3.5">Validation Errors Detected</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                    {validationResults.invalidRows.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-6 py-8 text-center text-emerald-600 font-bold">
                          ✓ No errors found! All rows are formatted correctly.
                        </td>
                      </tr>
                    ) : (
                      validationResults.invalidRows.map((inv: any, i: number) => (
                        <tr key={i} className="bg-red-50/20 hover:bg-red-50/30 transition">
                          <td className="px-6 py-4 font-mono font-bold text-red-650">{inv.row}</td>
                          <td className="px-6 py-4">
                            <div className="font-mono text-[10px] text-slate-500 whitespace-pre-wrap break-all max-w-[320px] bg-slate-100 border border-slate-200 p-2 rounded-lg">
                              {JSON.stringify(inv.data, null, 2)}
                            </div>
                          </td>
                          <td className="px-6 py-4 space-y-1">
                            {inv.errors.map((err: string, eIdx: number) => (
                              <div key={eIdx} className="flex items-start gap-1 text-red-600 font-semibold text-[11px] leading-relaxed">
                                <AlertTriangle className="w-3.5 h-3.5 text-red-500 mt-0.5 flex-shrink-0" />
                                <span>{err}</span>
                              </div>
                            ))}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </>
              )}
            </table>
          </div>
        </div>
      )}

      {/* Report Section */}
      {importReport && (
        <div className="space-y-6 animate-in zoom-in-95 duration-200">
          <div className="border border-slate-150 rounded-2xl bg-white shadow-sm overflow-hidden">
            {/* Header Status */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-6 border-b border-slate-150 bg-emerald-50/35 gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-600">
                  <CheckCircle2 className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900">Bulk Import Complete</h3>
                  <p className="text-xs text-slate-500 font-medium">The import pipeline has executed. Review results and copy default passwords below.</p>
                </div>
              </div>
              <div>
                <button
                  onClick={() => setImportReport(null)}
                  className="bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs py-2.5 px-4 rounded-xl transition shadow"
                >
                  Import Another File
                </button>
              </div>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-5 divide-x divide-y sm:divide-y-0 divide-slate-150 border-b border-slate-150 text-center bg-slate-50/20">
              <div className="p-4">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Processed</span>
                <span className="text-2xl font-black text-slate-800 block mt-1">{importReport.summary.total_processed}</span>
              </div>
              <div className="p-4">
                <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block">Imported</span>
                <span className="text-2xl font-black text-emerald-600 block mt-1">{importReport.summary.success_count}</span>
              </div>
              <div className="p-4">
                <span className="text-[10px] font-bold text-red-600 uppercase tracking-wider block">Failed</span>
                <span className="text-2xl font-black text-red-650 block mt-1">{importReport.summary.failure_count}</span>
              </div>
              <div className="p-4">
                <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider block">Links Created</span>
                <span className="text-2xl font-black text-indigo-800 block mt-1">{importReport.summary.links_succeeded}</span>
              </div>
              <div className="p-4">
                <span className="text-[10px] font-bold text-orange-600 uppercase tracking-wider block">Links Failed</span>
                <span className="text-2xl font-black text-orange-650 block mt-1">{importReport.summary.links_failed}</span>
              </div>
            </div>

            {/* Success Table */}
            <div className="p-6 space-y-4">
              <h4 className="font-bold text-sm text-slate-800">Successfully Imported Credentials</h4>
              <p className="text-xs text-slate-500">Please record or distribute these credentials to the respective operators. Passwords are encrypted in the database.</p>

              <div className="border border-slate-150 rounded-xl overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-150 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      <th className="px-5 py-3">Role</th>
                      <th className="px-5 py-3">Name</th>
                      <th className="px-5 py-3">Email Address</th>
                      <th className="px-5 py-3">Temp Password</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                    {importReport.successes.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-5 py-6 text-center text-slate-400 italic">No operators imported successfully.</td>
                      </tr>
                    ) : (
                      importReport.successes.map((succ, index) => {
                        const copyKey = `succ-${index}`;
                        const isCopied = !!copiedStates[copyKey];
                        
                        let roleBadgeColor = 'bg-slate-50 text-slate-700';
                        if (succ.role === 'driver') roleBadgeColor = 'bg-indigo-50 text-indigo-700';
                        else if (succ.role === 'parent') roleBadgeColor = 'bg-violet-50 text-violet-700';
                        else if (succ.role === 'student') roleBadgeColor = 'bg-emerald-50 text-emerald-700';

                        return (
                          <tr key={index} className="hover:bg-slate-50/30 transition">
                            <td className="px-5 py-3 font-medium">
                              <span className={`inline-flex px-2 py-0.5 rounded text-[9px] font-bold border uppercase ${roleBadgeColor}`}>
                                {succ.role}
                              </span>
                            </td>
                            <td className="px-5 py-3 font-bold text-slate-800">{succ.full_name}</td>
                            <td className="px-5 py-3 font-mono text-slate-500">{succ.email}</td>
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 text-white py-1.5 px-3 rounded-lg text-xs font-mono max-w-[200px]">
                                <span className="truncate flex-1">{succ.temp_password}</span>
                                <button
                                  type="button"
                                  onClick={() => copyToClipboard(succ.temp_password, copyKey)}
                                  className="text-slate-400 hover:text-white p-0.5 rounded transition hover:bg-slate-800"
                                >
                                  {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Error Failures list */}
            {importReport.failures.length > 0 && (
              <div className="p-6 border-t border-slate-150 space-y-3">
                <h4 className="font-bold text-sm text-red-650 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                  Import Execution Failures ({importReport.failures.length})
                </h4>
                <div className="space-y-2">
                  {importReport.failures.map((fail, index) => (
                    <div key={index} className="flex items-start gap-2.5 p-3.5 bg-red-50/40 border border-red-100 rounded-xl text-xs">
                      <span className="font-bold text-red-700 bg-red-100/50 border border-red-200 px-2 py-0.5 rounded">Row {fail.row}</span>
                      <div className="space-y-0.5">
                        <span className="font-bold text-slate-800">{fail.email}</span>
                        <p className="text-red-650 font-semibold">{fail.error}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Link Failures List */}
            {importReport.links.failures.length > 0 && (
              <div className="p-6 border-t border-slate-150 space-y-3">
                <h4 className="font-bold text-sm text-orange-650 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-orange-500" />
                  Student-Parent Linkage Errors ({importReport.links.failures.length})
                </h4>
                <div className="space-y-2">
                  {importReport.links.failures.map((lf, index) => (
                    <div key={index} className="p-3.5 bg-orange-50/40 border border-orange-100 rounded-xl text-xs">
                      <p className="font-bold text-slate-800">
                        Student: <span className="font-mono text-slate-500">{lf.studentEmail}</span> &rarr; Parent: <span className="font-mono text-slate-500">{lf.parentEmail}</span>
                      </p>
                      <p className="text-orange-600 font-semibold mt-1">{lf.error}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
