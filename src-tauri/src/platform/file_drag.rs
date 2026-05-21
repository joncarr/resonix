use std::path::Path;

pub fn start_file_drag(file_path: &str) -> Result<(), String> {
    let path = Path::new(file_path);

    if !path.is_file() {
        return Err("Drag source file does not exist.".to_string());
    }

    start_native_file_drag(path)
}

#[cfg(target_os = "windows")]
fn start_native_file_drag(path: &Path) -> Result<(), String> {
    windows_file_drag::start(path)
}

#[cfg(not(target_os = "windows"))]
fn start_native_file_drag(_path: &Path) -> Result<(), String> {
    Err("Native file dragging is currently implemented for Windows only.".to_string())
}

#[cfg(target_os = "windows")]
mod windows_file_drag {
    use std::{mem::size_of, os::windows::ffi::OsStrExt, path::Path, ptr::copy_nonoverlapping};

    use windows::{
        core::{implement, Result as WindowsResult, HRESULT},
        Win32::{
            Foundation::{
                DRAGDROP_S_CANCEL, DRAGDROP_S_DROP, DRAGDROP_S_USEDEFAULTCURSORS, DV_E_FORMATETC,
                DV_E_TYMED, E_NOTIMPL, OLE_E_ADVISENOTSUPPORTED, S_OK,
            },
            System::{
                Com::{
                    IAdviseSink, IDataObject, IDataObject_Impl, IEnumFORMATETC, IEnumSTATDATA,
                    DATADIR_GET, DVASPECT_CONTENT, FORMATETC, STGMEDIUM, STGMEDIUM_0,
                    TYMED_HGLOBAL,
                },
                Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE},
                Ole::{
                    DoDragDrop, IDropSource, IDropSource_Impl, OleInitialize, OleUninitialize,
                    CF_HDROP, DROPEFFECT_COPY,
                },
                SystemServices::{MK_LBUTTON, MODIFIERKEYS_FLAGS},
            },
            UI::Shell::{SHCreateStdEnumFmtEtc, DROPFILES},
        },
    };

    pub fn start(path: &Path) -> Result<(), String> {
        let path = path
            .canonicalize()
            .map_err(|error| format!("Could not prepare drag path: {error}"))?;
        let path = path.as_os_str().encode_wide().collect::<Vec<u16>>();

        let did_initialize_ole = unsafe { OleInitialize(None).is_ok() };
        let result = unsafe { do_drag(path) };

        if did_initialize_ole {
            unsafe { OleUninitialize() };
        }

        result
    }

    unsafe fn do_drag(path: Vec<u16>) -> Result<(), String> {
        let data_object: IDataObject = FileDataObject { path }.into();
        let drop_source: IDropSource = FileDropSource.into();
        let mut effect = DROPEFFECT_COPY;

        unsafe { DoDragDrop(&data_object, &drop_source, DROPEFFECT_COPY, &mut effect) }
            .ok()
            .map_err(|error| format!("Native file drag failed: {error}"))?;

        Ok(())
    }

    #[implement(IDataObject)]
    struct FileDataObject {
        path: Vec<u16>,
    }

    impl FileDataObject {
        fn format_matches(format: &FORMATETC) -> bool {
            format.cfFormat == CF_HDROP.0
                && format.dwAspect == DVASPECT_CONTENT.0
                && format.lindex == -1
                && (format.tymed & TYMED_HGLOBAL.0 as u32) != 0
        }

        unsafe fn create_hdrop_medium(&self) -> WindowsResult<STGMEDIUM> {
            let header_size = size_of::<DROPFILES>();
            let path_bytes = self.path.len() * size_of::<u16>();
            let terminator_bytes = 2 * size_of::<u16>();
            let allocation_size = header_size + path_bytes + terminator_bytes;
            let hglobal = unsafe { GlobalAlloc(GMEM_MOVEABLE, allocation_size)? };
            let memory = unsafe { GlobalLock(hglobal) as *mut u8 };

            if memory.is_null() {
                return Err(windows::core::Error::from_hresult(DV_E_TYMED));
            }

            let dropfiles = DROPFILES {
                pFiles: header_size as u32,
                pt: Default::default(),
                fNC: windows::core::BOOL(0),
                fWide: windows::core::BOOL(1),
            };

            unsafe {
                copy_nonoverlapping(
                    &dropfiles as *const DROPFILES as *const u8,
                    memory,
                    header_size,
                );
                copy_nonoverlapping(
                    self.path.as_ptr() as *const u8,
                    memory.add(header_size),
                    path_bytes,
                );
                memory.add(header_size + path_bytes).cast::<u16>().write(0);
                memory
                    .add(header_size + path_bytes + size_of::<u16>())
                    .cast::<u16>()
                    .write(0);
                let _ = GlobalUnlock(hglobal);
            }

            Ok(STGMEDIUM {
                tymed: TYMED_HGLOBAL.0 as u32,
                u: STGMEDIUM_0 { hGlobal: hglobal },
                pUnkForRelease: Default::default(),
            })
        }
    }

    impl IDataObject_Impl for FileDataObject_Impl {
        fn GetData(&self, pformatetcin: *const FORMATETC) -> WindowsResult<STGMEDIUM> {
            let format = unsafe { pformatetcin.as_ref() }
                .ok_or_else(|| windows::core::Error::from_hresult(DV_E_FORMATETC))?;

            if !FileDataObject::format_matches(format) {
                return Err(windows::core::Error::from_hresult(DV_E_FORMATETC));
            }

            unsafe { self.create_hdrop_medium() }
        }

        fn GetDataHere(
            &self,
            _pformatetc: *const FORMATETC,
            _pmedium: *mut STGMEDIUM,
        ) -> WindowsResult<()> {
            Err(windows::core::Error::from_hresult(E_NOTIMPL))
        }

        fn QueryGetData(&self, pformatetc: *const FORMATETC) -> HRESULT {
            match unsafe { pformatetc.as_ref() } {
                Some(format) if FileDataObject::format_matches(format) => S_OK,
                _ => DV_E_FORMATETC,
            }
        }

        fn GetCanonicalFormatEtc(
            &self,
            _pformatectin: *const FORMATETC,
            pformatetcout: *mut FORMATETC,
        ) -> HRESULT {
            if let Some(format) = unsafe { pformatetcout.as_mut() } {
                format.ptd = std::ptr::null_mut();
            }

            E_NOTIMPL
        }

        fn SetData(
            &self,
            _pformatetc: *const FORMATETC,
            _pmedium: *const STGMEDIUM,
            _frelease: windows::core::BOOL,
        ) -> WindowsResult<()> {
            Err(windows::core::Error::from_hresult(E_NOTIMPL))
        }

        fn EnumFormatEtc(&self, dwdirection: u32) -> WindowsResult<IEnumFORMATETC> {
            if dwdirection != DATADIR_GET.0 as u32 {
                return Err(windows::core::Error::from_hresult(E_NOTIMPL));
            }

            let formats = [FORMATETC {
                cfFormat: CF_HDROP.0,
                ptd: std::ptr::null_mut(),
                dwAspect: DVASPECT_CONTENT.0,
                lindex: -1,
                tymed: TYMED_HGLOBAL.0 as u32,
            }];

            unsafe { SHCreateStdEnumFmtEtc(&formats) }
        }

        fn DAdvise(
            &self,
            _pformatetc: *const FORMATETC,
            _advf: u32,
            _padvsink: windows::core::Ref<'_, IAdviseSink>,
        ) -> WindowsResult<u32> {
            Err(windows::core::Error::from_hresult(OLE_E_ADVISENOTSUPPORTED))
        }

        fn DUnadvise(&self, _dwconnection: u32) -> WindowsResult<()> {
            Err(windows::core::Error::from_hresult(OLE_E_ADVISENOTSUPPORTED))
        }

        fn EnumDAdvise(&self) -> WindowsResult<IEnumSTATDATA> {
            Err(windows::core::Error::from_hresult(OLE_E_ADVISENOTSUPPORTED))
        }
    }

    #[implement(IDropSource)]
    struct FileDropSource;

    impl IDropSource_Impl for FileDropSource_Impl {
        fn QueryContinueDrag(
            &self,
            fescapepressed: windows::core::BOOL,
            grfkeystate: MODIFIERKEYS_FLAGS,
        ) -> HRESULT {
            if fescapepressed.as_bool() {
                return DRAGDROP_S_CANCEL;
            }

            if (grfkeystate.0 & MK_LBUTTON.0) == 0 {
                return DRAGDROP_S_DROP;
            }

            S_OK
        }

        fn GiveFeedback(&self, _dweffect: windows::Win32::System::Ole::DROPEFFECT) -> HRESULT {
            DRAGDROP_S_USEDEFAULTCURSORS
        }
    }
}
